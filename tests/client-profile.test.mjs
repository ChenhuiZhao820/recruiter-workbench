import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as screeningCore from "../lib/screening-core.mjs";
import * as talent from "../lib/talent.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const loaded = new Map();

// Loads a TypeScript module from lib/, and its relative imports, as CommonJS.
function load(file) {
  const filename = path.join(root, file);
  if (loaded.has(filename)) return loaded.get(filename);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  loaded.set(filename, module.exports);
  const local = (id) => {
    if (id.endsWith("screening-core.mjs")) return screeningCore;
    if (id.endsWith("talent.mjs")) return talent;
    if (id.startsWith("./")) {
      const target = path.join(path.dirname(file), id);
      return load(existsSync(path.join(root, `${target}.ts`)) ? `${target}.ts` : target);
    }
    return require(id);
  };
  vm.runInNewContext(source, { module, exports: module.exports, Intl, Date, URL, encodeURIComponent, require: local }, { filename });
  loaded.set(filename, module.exports);
  return module.exports;
}

const { clientProfile, personFacts, PERSON_FIELD_POLICY, CANDIDATE_FIELD_POLICY } = load("lib/client-profile.ts");

// The field names of one model in the source schema, relations included.
function schemaFields(model) {
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const block = schema.match(new RegExp(`\\nmodel ${model} \\{\\n([\\s\\S]*?)\\n\\}`));
  assert.ok(block, `model ${model} is in the schema`);
  return block[1].split("\n").map((line) => line.trim()).filter((line) => /^[a-zA-Z]\w*\s/.test(line)).map((line) => line.split(/\s+/)[0]);
}

test("every Person and Candidate column is classified, so a new one cannot reach a client unreviewed", () => {
  for (const [model, policy] of [["Person", PERSON_FIELD_POLICY], ["Candidate", CANDIDATE_FIELD_POLICY]]) {
    const fields = schemaFields(model);
    assert.deepEqual([...fields].sort(), Object.keys(policy).sort(), `${model} fields and policy`);
  }
  for (const field of ["profileUrl", "memberId", "email", "notes", "revisitOn", "revisitNote", "doNotContact"]) {
    assert.equal(PERSON_FIELD_POLICY[field], "hidden", field);
  }
  for (const field of ["profileUrl", "memberId", "notes", "stage"]) assert.equal(CANDIDATE_FIELD_POLICY[field], "hidden", field);
});

// Results come from another realm, so compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const now = new Date("2026-10-17T12:00:00Z");
const SECRET = "SENTINEL-HIDDEN";

// A whole row with every hidden field set to something recognisable.
function row(policy, shown) {
  return Object.fromEntries(Object.entries(policy).map(([field, rule]) => [field, rule === "hidden" ? `${SECRET}-${field}` : shown[field] ?? null]));
}

const shownPerson = {
  fullName: "Imogen Achterberg",
  headline: "Platform engineer",
  salaryMin: 85000,
  salaryMax: 95000,
  salaryCurrency: "GBP",
  salaryNote: "Base only",
  noticeWeeks: 12,
  availableFrom: null,
  location: "Manchester",
  remotePreference: "hybrid",
  rightToWork: "has_right",
  rightToWorkNote: null,
  skillsSummary: "Kubernetes, Terraform",
  motivation: "Wants a smaller team",
  factsConfirmedAt: new Date("2026-10-02T10:00:00Z"),
};

test("the client profile carries the shown fields and none of the hidden ones", () => {
  const person = row(PERSON_FIELD_POLICY, shownPerson);
  const candidate = row(CANDIDATE_FIELD_POLICY, { fullName: "Imogen A", headline: "Engineer" });
  const profile = clientProfile({ person, candidate, pitch: "  Ran the platform migration at her last firm  ", now });
  assert.doesNotMatch(JSON.stringify(profile), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(profile), /linkedin/i);
  assert.equal(profile.fullName, "Imogen Achterberg");
  assert.equal(profile.headline, "Platform engineer");
  assert.equal(profile.pitch, "Ran the platform migration at her last firm");
  assert.deepEqual(plain(profile.facts).map((f) => [f.label, f.value, f.note]), [
    ["Salary expectation", "£85,000 to £95,000 a year", "Base only"],
    ["Notice period", "12 weeks", null],
    ["Location and remote", "Manchester, Hybrid", null],
    ["Right to work", "Has the right to work", null],
  ]);
  assert.equal(profile.factsConfirmedOn, "2 Oct 2026");
  assert.equal(profile.factsMayBeOutOfDate, false);
  assert.equal(profile.skills, "Kubernetes, Terraform");
});

test("unconfirmed facts are left out, old ones are marked, and the candidacy fills a missing name", () => {
  const bare = { ...Object.fromEntries(Object.keys(shownPerson).map((k) => [k, null])), fullName: " ", headline: null };
  const profile = clientProfile({ person: bare, candidate: { fullName: "Sam Okafor", headline: "Data lead" }, now });
  assert.equal(profile.fullName, "Sam Okafor");
  assert.equal(profile.headline, "Data lead");
  assert.deepEqual(plain(profile.facts), []);
  assert.equal(profile.factsConfirmedOn, null);
  assert.equal(profile.factsMayBeOutOfDate, false);

  const old = clientProfile({ person: { ...shownPerson, factsConfirmedAt: new Date("2026-03-01T00:00:00Z") }, now });
  assert.equal(old.factsMayBeOutOfDate, true);

  const fromDate = personFacts({ ...shownPerson, noticeWeeks: null, availableFrom: new Date("2026-12-01T00:00:00Z") });
  assert.deepEqual(plain(fromDate).find((f) => f.field === "notice"), { field: "notice", label: "Notice period", value: "Available from 1 Dec 2026", note: null, notDiscussed: false });
});
