import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildSearchText, canonicalProfileUrl, cleanEmail, cleanMemberId, normalizeProfileUrl, suppressionHashes } from "../lib/person-keys.mjs";
import { planBackfill } from "../scripts/backfill-people.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Date, Buffer, URL, require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) }, { filename });
  return module.exports;
}

test("one canonical link per LinkedIn profile, whatever shape it was pasted in", () => {
  const same = [
    "linkedin.com/in/Jane-Doe",
    "https://www.linkedin.com/in/jane-doe/",
    "https://uk.linkedin.com/in/jane-doe?trk=public_profile",
    "http://linkedin.com/in/JANE-DOE#experience",
    "//www.linkedin.com/in/jane-doe/details/experience/",
  ];
  for (const input of same) assert.equal(canonicalProfileUrl(input), "https://www.linkedin.com/in/jane-doe", input);
  assert.notEqual(canonicalProfileUrl("linkedin.com/in/jane-doe-2"), canonicalProfileUrl("linkedin.com/in/jane-doe"));
  assert.equal(canonicalProfileUrl("https://www.linkedin.com/in/%C3%A9lodie-martin"), "https://www.linkedin.com/in/%C3%A9lodie-martin");
  assert.equal(canonicalProfileUrl("https://github.com/someone/"), "https://github.com/someone");
  assert.equal(canonicalProfileUrl("not a link at all"), "not a link at all");
  for (const empty of ["", "   ", null, undefined]) assert.equal(canonicalProfileUrl(empty), null);
  // normalizeProfileUrl keeps its old behaviour for the rest of the app.
  assert.equal(normalizeProfileUrl("linkedin.com/in/x"), "https://linkedin.com/in/x");
  assert.equal(normalizeProfileUrl("javascript:alert(1)"), "javascript:alert(1)");
});

test("identifiers are cleaned before they are trusted", () => {
  assert.equal(cleanMemberId("ACoAAB12345"), "ACoAAB12345");
  for (const bad of ["abc", "has space 123", "x".repeat(61), "", null]) assert.equal(cleanMemberId(bad), null);
  assert.equal(cleanEmail("  Jane@Example.COM "), "jane@example.com");
  for (const bad of ["jane", "jane@", "@example.com", "", null]) assert.equal(cleanEmail(bad), null);
});

test("suppression keeps one hash per identifier, prefixed by its type, and no raw value", () => {
  const hashes = suppressionHashes({ profileUrl: "uk.linkedin.com/in/Jane-Doe/", memberId: "ACoAAB12345", email: "Jane@Example.com" });
  assert.equal(hashes.length, 3);
  for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);
  // The same person written another way produces the same hashes.
  assert.deepEqual(suppressionHashes({ profileUrl: "https://www.linkedin.com/in/jane-doe" })[0], hashes[0]);
  assert.deepEqual(suppressionHashes({}), []);
  assert.equal(JSON.stringify(hashes).includes("jane"), false);
});

test("search text is lower-cased, trimmed and bounded", () => {
  assert.equal(buildSearchText(["  Jane DOE ", null, "Staff Engineer\n at Acme", ""]), "jane doe staff engineer at acme");
  assert.equal(buildSearchText(["x".repeat(5000)]).length, 4000);
});

test("backfill matches by member id, then link, never by name, and links each candidate once", () => {
  const candidates = [
    { id: "c1", ownerId: "u1", fullName: "Jane Doe", profileUrl: "linkedin.com/in/jane-doe", memberId: null, headline: "Engineer" },
    { id: "c2", ownerId: "u1", fullName: "Jane D.", profileUrl: "https://uk.linkedin.com/in/Jane-Doe/", memberId: "ACoAAJane1", headline: null },
    { id: "c3", ownerId: "u1", fullName: "Someone", profileUrl: null, memberId: "ACoAAJane1", headline: null },
    { id: "c4", ownerId: "u1", fullName: "Jane Doe", profileUrl: null, memberId: null, headline: null },
    { id: "c5", ownerId: "u2", fullName: "Jane Doe", profileUrl: "linkedin.com/in/jane-doe", memberId: null, headline: null },
    { id: "c6", ownerId: "u1", fullName: "Existing", profileUrl: "linkedin.com/in/existing", memberId: null, headline: null },
  ];
  const people = [{ id: "p-existing", ownerId: "u1", profileUrl: "https://www.linkedin.com/in/existing", memberId: null }];
  const { creates, links } = planBackfill(candidates, people);
  const personOf = (id) => links.find((link) => link.candidateId === id).person;
  assert.equal(links.length, candidates.length);
  assert.equal(personOf("c1"), personOf("c2"));
  assert.equal(personOf("c2"), personOf("c3"));
  assert.equal(personOf("c1").memberId, "ACoAAJane1");
  // Same name, no identifiers: a separate person.
  assert.notEqual(personOf("c4"), personOf("c1"));
  // Same link in another account: a separate person.
  assert.notEqual(personOf("c5"), personOf("c1"));
  assert.equal(personOf("c6").id, "p-existing");
  assert.equal(creates.length, 3);
  // Running again over the result links nothing new.
  assert.deepEqual(planBackfill([], people), { creates: [], links: [] });
});

test("findOrCreatePerson reuses a person by member id or link and never by name", async () => {
  const store = [];
  let nextId = 1;
  const client = {
    person: {
      async findUnique({ where }) {
        if (where.userId_memberId) return store.find((p) => p.userId === where.userId_memberId.userId && p.memberId === where.userId_memberId.memberId) ?? null;
        if (where.userId_profileUrl) return store.find((p) => p.userId === where.userId_profileUrl.userId && p.profileUrl === where.userId_profileUrl.profileUrl) ?? null;
        return null;
      },
      async create({ data }) {
        const row = { id: `p${nextId++}`, userId: data.user.connect.id, fullName: data.fullName, profileUrl: data.profileUrl, memberId: data.memberId, headline: data.headline, searchText: data.searchText };
        store.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = store.find((p) => p.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  const people = load("lib/people.ts", {
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
    "./db": { db: client },
    "./person-keys.mjs": { buildSearchText, canonicalProfileUrl, cleanMemberId, suppressionHashes },
  });
  const a = await people.findOrCreatePerson(client, "u1", { fullName: "Jane Doe", profileUrl: "linkedin.com/in/jane-doe" });
  const b = await people.findOrCreatePerson(client, "u1", { fullName: "J. Doe", profileUrl: "https://uk.linkedin.com/in/Jane-Doe/", memberId: "ACoAAJane1", headline: "Staff Engineer" });
  assert.equal(b.id, a.id);
  assert.equal(b.memberId, "ACoAAJane1");
  assert.equal(b.headline, "Staff Engineer");
  const c = await people.findOrCreatePerson(client, "u1", { fullName: "Anyone", memberId: "ACoAAJane1" });
  assert.equal(c.id, a.id);
  const d = await people.findOrCreatePerson(client, "u1", { fullName: "Jane Doe" });
  assert.notEqual(d.id, a.id);
  const e = await people.findOrCreatePerson(client, "u2", { fullName: "Jane Doe", profileUrl: "linkedin.com/in/jane-doe" });
  assert.notEqual(e.id, a.id);
  assert.equal(store.length, 3);
});

test("CSV export escapes quotes and neutralises spreadsheet formulas", () => {
  const { toCsv, isExportTable } = load("lib/export.ts", { "./db": { db: {} } });
  const csv = toCsv([
    { name: 'Jane "JD" Doe', note: "line one\nline two", formula: "=HYPERLINK(\"x\")", plus: "+44 7700", empty: null, flag: true },
  ]);
  assert.equal(
    csv,
    'name,note,formula,plus,empty,flag\r\n"Jane ""JD"" Doe","line one\nline two","\'=HYPERLINK(""x"")",\'+44 7700,,true\r\n'
  );
  assert.equal(toCsv([]), "");
  assert.equal(isExportTable("people"), true);
  assert.equal(isExportTable("sessions"), false);
});
