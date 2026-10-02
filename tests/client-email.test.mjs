import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as screeningCore from "../lib/screening-core.mjs";

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

const { clientEmailBody, clientEmailSubject, mailtoHref, mailtoSubjectOnly, MAILTO_LIMIT } = load("lib/client-email.ts");

const summary = {
  version: 1,
  ai: {},
  fields: {
    salary: { value: { min: 85000, max: 95000, currency: "GBP", note: "Base only" }, not_discussed: false, confirmed: true },
    notice: { value: { weeks: 12, available_from: null, note: "Negotiable" }, not_discussed: false, confirmed: true },
    location: { value: { location: "Manchester", remote: "hybrid", note: null }, not_discussed: false, confirmed: true },
    right_to_work: { value: { status: null, note: null }, not_discussed: true, confirmed: true },
  },
};
const input = {
  candidateName: "Imogen Achterberg",
  roleTitle: "Senior Platform Engineer",
  client: "Halden Systems",
  recruiterName: "Morven Ellis",
  confirmedAt: new Date("2026-10-02T10:00:00Z"),
  summary,
  skillsSummary: "Kubernetes, Terraform",
  motivation: null,
};

test("the client email is built from the confirmed facts, says they are unverified, and is already normalised", () => {
  const body = clientEmailBody(input);
  assert.equal(clientEmailSubject(input), "Senior Platform Engineer: Imogen Achterberg");
  assert.match(body, /^Hi,\n\nI would like to put forward Imogen Achterberg for the Senior Platform Engineer role\. Imogen has agreed for me to share their details with Halden Systems\./);
  assert.match(body, /\n- Salary expectation: £85,000 to £95,000 a year \(Base only\)\n- Notice period: 12 weeks \(Negotiable\)\n- Location and remote: Manchester, Hybrid\n- Right to work: not discussed yet\n/);
  assert.match(body, /\nSkills: Kubernetes, Terraform\n/);
  assert.doesNotMatch(body, /Why they would move/);
  assert.match(body, /own words from our call on 2 Oct 2026; I have not verified them\./);
  assert.match(body, /\n\nMorven Ellis$/);
  assert.doesNotMatch(body, /\n{3,}| \n|—/);

  const noClient = clientEmailBody({ ...input, client: null, recruiterName: "", skillsSummary: null });
  assert.match(noClient, /share their details\.\n/);
  assert.doesNotMatch(noClient, /Skills:/);
  assert.match(noClient, /take this further\.$/);
});

test("mailto: carries the recipient, subject and CRLF body, and gives up when it would be too long", () => {
  const href = mailtoHref(" hiring@halden.example ", "Role: Name", "Hi,\n\nLine two & more");
  assert.equal(href, "mailto:hiring@halden.example?subject=Role%3A%20Name&body=Hi%2C%0D%0A%0D%0ALine%20two%20%26%20more");
  assert.equal(mailtoHref("", "S", "x".repeat(MAILTO_LIMIT)), null);
  assert.equal(mailtoSubjectOnly("a@b.example", "S & T"), "mailto:a@b.example?subject=S%20%26%20T");
  // A recipient cannot smuggle extra headers into the address.
  assert.equal(mailtoHref("a@b.example?cc=x@y.example", "S", "B"), "mailto:a@b.example%3Fcc%3Dx@y.example?subject=S&body=B");
});

test("client email actions are behind their feature, scoped to the owner, and store no content", () => {
  const actions = readFileSync(path.join(root, "app/actions/client-email.ts"), "utf8");
  const bodies = actions.split("export async function ").slice(1);
  assert.equal(bodies.length, 2);
  for (const body of bodies) assert.match(body, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("clientEmail"\);/);
  assert.match(actions, /where: \{ id: screeningId, status: "confirmed", candidate: \{ role: \{ userId: ownerId \} \} \}/);
  assert.doesNotMatch(actions, /recipient|body:|subject/i);
  assert.match(actions, /recordUsage\(tx, user\.id, "client_email_sent"\)/);
});
