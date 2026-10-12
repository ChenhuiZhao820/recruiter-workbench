import test from "node:test";
import assert from "node:assert/strict";
import { MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS, readSpreadsheet, SheetError } from "../lib/sheet-read.mjs";
import {
  classifyRows, cleanFileName, cleanRows, gapFills, guessMapping, hasNameColumn, identifiersOf, parseMapping, provenanceNote, truthy,
} from "../lib/people-import.mjs";
import { suppressionHashes } from "../lib/person-keys.mjs";
import { xlsx, zip } from "./xlsx-fixture.mjs";

const grid = (file) => readSpreadsheet(file).rows.map((row) => row.cells);

// ---- reading files --------------------------------------------------------

test("reads text, numbers and empty cells from an .xlsx, with shared or inline strings", () => {
  const rows = [["Name", "Headline", "Phone"], ["Ana Test", "Engineer & lead <x>", 12345], ["Ben Test", "", "07"]];
  for (const shared of [true, false]) {
    assert.deepEqual(grid(xlsx(rows, { shared })), [["Name", "Headline", "Phone"], ["Ana Test", "Engineer & lead <x>", "12345"], ["Ben Test", "", "07"]]);
  }
});

test("reports the sheet's own row numbers and skips blank rows", () => {
  const file = zip({
    "xl/workbook.xml": "<workbook/>",
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"/><row r="5"><c r="A5" t="inlineStr"><is><t>Cal Test</t></is></c></row></sheetData></worksheet>`,
  });
  assert.deepEqual(readSpreadsheet(file).rows.map((row) => row.n), [1, 5]);
});

test("a formula cell contributes its saved value and nothing is evaluated", () => {
  const file = zip({
    "xl/workbook.xml": "<workbook/>",
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="str"><f>HYPERLINK("http://evil.invalid")</f><v>Saved Value</v></c></row></sheetData></worksheet>`,
  });
  assert.deepEqual(grid(file), [["Name"], ["Saved Value"]]);
});

test("reads CSV with quotes, embedded newlines, a byte-order mark and either delimiter", () => {
  const csv = '\uFEFFName;Notes\r\n"Ana, Test";"line one\nline two"\r\nBen Test;"say ""hi"""\r\n';
  assert.deepEqual(grid(Buffer.from(csv)), [["Name", "Notes"], ["Ana, Test", "line one\nline two"], ["Ben Test", 'say "hi"']]);
  assert.deepEqual(grid(Buffer.from("Name\tEmail\nAna\ta@example.test\n")), [["Name", "Email"], ["Ana", "a@example.test"]]);
});

test("falls back to Windows-1252 when a CSV is not UTF-8", () => {
  const bytes = Buffer.concat([Buffer.from("Name\nJos"), Buffer.from([0xe9]), Buffer.from("\n")]);
  assert.deepEqual(grid(bytes), [["Name"], ["Jos\u00e9"]]);
});

test("refuses files it cannot or should not read, with a message a recruiter can act on", () => {
  const refused = (bytes, pattern) => assert.throws(() => readSpreadsheet(bytes), (error) => error instanceof SheetError && pattern.test(error.message));
  refused(Buffer.alloc(0), /empty/i);
  refused(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), /\.xls/);
  refused(Buffer.from("Name\n"), /nothing to import/);
  refused(Buffer.from("PK\u0003\u0004 and then nothing useful at all"), /not a readable/);
  refused(zip({ "readme.txt": "hello" }), /not an Excel workbook/);
  refused(zip({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": "<worksheet/>" }, { flags: 1 }), /password/);
  refused(Buffer.alloc(MAX_FILE_BYTES + 1, 65), /larger than/);
});

test("refuses more rows or columns than the importer takes", () => {
  const many = ["Name", ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Person ${i}`)].map((name) => [name]);
  assert.throws(() => readSpreadsheet(xlsx(many)), /more than 2,000 rows/);
  assert.throws(() => readSpreadsheet(Buffer.from(many.map((row) => row[0]).join("\n"))), /more than 2,000 rows/);
  const exactly = ["Name", ...Array.from({ length: MAX_ROWS }, (_, i) => `Person ${i}`)].map((name) => [name]);
  assert.equal(readSpreadsheet(xlsx(exactly)).rows.length, MAX_ROWS + 1);
  const wide = [Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `H${i}`), Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `v${i}`)];
  assert.throws(() => readSpreadsheet(Buffer.from(wide.map((row) => row.join(",")).join("\n"))), /more than 50 columns/);
});

test("a zip that expands far past what it declares is refused, not expanded", () => {
  const bomb = zip({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": Buffer.alloc(40 * 1024 * 1024, 97) }, { lieSize: 100 });
  assert.ok(bomb.length < MAX_FILE_BYTES, "the fixture itself must be small");
  assert.throws(() => readSpreadsheet(bomb), /too large/);
  const honest = zip({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": Buffer.alloc(40 * 1024 * 1024, 97) });
  assert.throws(() => readSpreadsheet(honest), /too large/);
});

test("hostile XML with unclosed elements ends quickly", () => {
  const junk = "<row r=\"1\">" + "<c r=\"A1\">".repeat(200_000);
  const file = zip({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": junk });
  const started = Date.now();
  assert.throws(() => readSpreadsheet(file), SheetError);
  assert.ok(Date.now() - started < 2000);
});

// ---- columns ----------------------------------------------------------------

test("guesses columns from common headings, one column for each field", () => {
  assert.deepEqual(guessMapping(["First Name", "Surname", "LinkedIn URL", "Job Title", "E-mail", "Comments", "DNC", "Favourite colour", "Profile"]), [
    "firstName", "lastName", "profileUrl", "headline", "email", "notes", "doNotContact", "", "",
  ]);
  assert.deepEqual(guessMapping(["Name", "Full name"]), ["fullName", ""]);
  assert.deepEqual(guessMapping(["", "  "]), ["", ""]);
});

test("a mapping from a browser keeps only known fields, once each", () => {
  assert.deepEqual(parseMapping(["fullName", "email", "email", "__proto__", 5, "salaryMin"], 6), ["fullName", "email", "", "", "", ""]);
  assert.equal(parseMapping(["fullName"], 2), null);
  assert.equal(parseMapping("fullName", 1), null);
  assert.equal(hasNameColumn(["email"]), false);
  assert.equal(hasNameColumn(["", "lastName"]), true);
});

// ---- cleaning ---------------------------------------------------------------

const MAP = ["fullName", "profileUrl", "memberId", "headline", "location", "skills", "email", "notes", "doNotContact"];
const row = (n, cells) => ({ n, cells });
const clean = (cells, mapping = MAP) => cleanRows([row(2, cells)], mapping)[0];

test("cleans a row: tidy text, canonical link, lower-case email", () => {
  const out = clean(["  Ana\u00a0 Test ", "linkedin.com/in/Ana-Test/?trk=x", "ACoAAB12345", " Staff  Engineer ", "Leeds", "Go, SQL", "ANA@Example.Test", "Met at\r\na meetup  ", "no"]);
  assert.deepEqual(
    { ...out, warnings: out.warnings },
    { n: 2, name: "Ana Test", profileUrl: "https://www.linkedin.com/in/ana-test", memberId: "ACoAAB12345", headline: "Staff Engineer", location: "Leeds", skills: "Go, SQL", email: "ana@example.test", notes: "Met at\na meetup", doNotContact: false, warnings: [], error: null }
  );
});

test("builds a name from first and last name when there is no full name", () => {
  assert.equal(clean(["Ana", "Test"], ["firstName", "lastName"]).name, "Ana Test");
  assert.equal(clean(["", "Test"], ["firstName", "lastName"]).name, "Test");
});

test("a row without a usable name is skipped; a bad link, id or email is left out and reported", () => {
  assert.equal(clean(["   ", "", "", "", "", "", "", "", ""]).error, "No name");
  assert.equal(clean(["x".repeat(201)]).error, "Name is too long");
  const out = clean(["Ana", "javascript:alert(1)", "nope", "", "", "", "not an email", "", ""]);
  assert.equal(out.error, null);
  assert.equal(out.profileUrl, null);
  assert.equal(out.memberId, null);
  assert.equal(out.email, null);
  assert.equal(out.warnings.length, 3);
  for (const link of ["ftp://files.example.test/a", "data:text/html,hi", "https://localhost/x", "file:///c:/x"]) {
    assert.equal(clean(["Ana", link]).profileUrl, null, link);
  }
  assert.equal(clean(["Ana", "https://example.test/cv"]).profileUrl, "https://example.test/cv");
});

test("takes the first valid address from a cell holding several", () => {
  assert.equal(clean(["Ana", "", "", "", "", "", "work, ana@example.test; other@example.test"]).email, "ana@example.test");
});

test("anything but a plain no in a do-not-contact cell means do not contact", () => {
  for (const yes of ["yes", "Y", "TRUE", "1", "x", "DNC", "do not contact", "asked to be removed"]) assert.equal(truthy(yes), true, yes);
  for (const no of ["", " ", "no", "No", "N", "false", "0", "-", "none"]) assert.equal(truthy(no), false, JSON.stringify(no));
});

test("control and zero-width characters never reach a record, and a formula-like value stays text", () => {
  const out = clean(["=SUM(A1)\u0000\u200b", "", "", "+1 headline", "", "", "", "", ""]);
  assert.equal(out.name, "=SUM(A1)");
  assert.equal(out.headline, "+1 headline");
});

test("long free text is capped", () => {
  const out = clean(["Ana", "", "", "h".repeat(900), "", "s".repeat(5000), "", "n".repeat(20_000), ""]);
  assert.equal(out.headline.length, 300);
  assert.equal(out.skills.length, 2000);
  assert.equal(out.notes.length, 10_000);
});

// ---- who each row is --------------------------------------------------------

const known = (over = {}) => ({ byMember: new Map(), byUrl: new Map(), byEmail: new Map(), suppressed: new Set(), ...over });
const person = (id, over = {}) => ({ id, fullName: "Someone", motivation: null, doNotContact: false, headline: null, location: null, skillsSummary: null, email: null, ...over });
const rows = (cells) => cleanRows(cells.map((c, i) => row(i + 2, c)), MAP);
const pad = (name, extra = {}) => {
  const cells = [name, "", "", "", "", "", "", "", ""];
  for (const [index, value] of Object.entries(extra)) cells[MAP.indexOf(index)] = value;
  return cells;
};

test("member id wins over link, and email matches only a row with neither", () => {
  const byMember = person("m");
  const byUrl = person("u");
  const byEmail = person("e");
  const k = known({
    byMember: new Map([["ACoAAB12345", byMember]]),
    byUrl: new Map([["https://www.linkedin.com/in/ana", byUrl]]),
    byEmail: new Map([["ana@example.test", byEmail]]),
  });
  const { rows: out } = classifyRows(rows([
    pad("A", { memberId: "ACoAAB12345", profileUrl: "linkedin.com/in/zzz" }),
    pad("B", { profileUrl: "linkedin.com/in/ana" }),
    pad("C", { email: "ana@example.test" }),
    pad("D", { profileUrl: "linkedin.com/in/other", email: "ana@example.test" }),
  ]), k);
  assert.deepEqual(out.map((r) => [r.status, r.existing?.id ?? null]), [["existing", "m"], ["existing", "u"], ["existing", "e"], ["new", null]]);
});

test("a name alone never matches anyone", () => {
  const { rows: out } = classifyRows(rows([pad("Ana Test")]), known({ byUrl: new Map([["https://www.linkedin.com/in/ana", person("u", { fullName: "Ana Test" })]]) }));
  assert.equal(out[0].status, "new");
});

test("people deleted before are skipped on any identifier, whichever the row carries", () => {
  const erased = new Set(suppressionHashes({ email: "gone@example.test" }));
  const { rows: out, totals } = classifyRows(rows([
    pad("A", { email: "gone@example.test", profileUrl: "linkedin.com/in/new-link" }),
    pad("B", { email: "fine@example.test" }),
  ]), known({ suppressed: erased }));
  assert.deepEqual(out.map((r) => r.status), ["suppressed", "new"]);
  assert.equal(totals.suppressed, 1);
});

test("a repeat within the file is skipped and the first row wins", () => {
  const { rows: out } = classifyRows(rows([
    pad("A", { profileUrl: "linkedin.com/in/dup" }),
    pad("B", { profileUrl: "https://uk.linkedin.com/in/DUP/" }),
    pad("C", { email: "x@example.test" }),
    pad("D", { email: "X@example.test" }),
    pad("E"),
    pad("F"),
  ]), known());
  assert.deepEqual(out.map((r) => r.status), ["new", "duplicate", "new", "duplicate", "new", "new"]);
});

test("totals add up and say who cannot be recognised later", () => {
  const { totals } = classifyRows(rows([pad("A", { profileUrl: "linkedin.com/in/a" }), pad("B"), pad(""), pad("C", { email: "c@example.test" })]), known());
  assert.deepEqual(totals, { rows: 4, new: 3, existing: 0, suppressed: 0, duplicate: 0, invalid: 1, warned: 0, noLink: 2, doNotContactOnExisting: 0 });
});

test("do not contact on someone already there is counted only when it would change something", () => {
  const k = known({ byUrl: new Map([["https://www.linkedin.com/in/a", person("a")], ["https://www.linkedin.com/in/b", person("b", { doNotContact: true })]]) });
  const { totals } = classifyRows(rows([
    pad("A", { profileUrl: "linkedin.com/in/a", doNotContact: "yes" }),
    pad("B", { profileUrl: "linkedin.com/in/b", doNotContact: "yes" }),
  ]), k);
  assert.equal(totals.doNotContactOnExisting, 1);
});

test("gap filling adds to empty fields and never overwrites", () => {
  const r = cleanRows([row(2, pad("A", { headline: "New headline", location: "Leeds", skills: "Go", email: "a@example.test" }))], MAP)[0];
  assert.deepEqual(gapFills(person("x", { headline: "Kept" }), r), { location: "Leeds", skillsSummary: "Go", email: "a@example.test" });
  assert.deepEqual(gapFills(person("x", { headline: "h", location: "l", skillsSummary: "s", email: "e@example.test" }), r), {});
});

test("identifiers to look up cover only usable rows", () => {
  const ids = identifiersOf(rows([pad("A", { profileUrl: "linkedin.com/in/a", email: "a@example.test", memberId: "ACoAAB12345" }), pad("")]));
  assert.deepEqual([ids.memberIds, ids.profileUrls, ids.emails, ids.hashes.length], [["ACoAAB12345"], ["https://www.linkedin.com/in/a"], ["a@example.test"], 3]);
});

test("the note recording where someone came from names the file and the day, safely", () => {
  assert.equal(provenanceNote("C:\\Users\\me\\Documents\\Leads \"2026\".xlsx", new Date("2026-10-12T09:00:00Z")), 'Imported from "Leads 2026.xlsx" on 2026-10-12.');
  assert.equal(cleanFileName(""), "a spreadsheet");
  assert.equal(cleanFileName("x".repeat(200)).length, 80);
});
