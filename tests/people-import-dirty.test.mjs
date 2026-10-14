import test from "node:test";
import assert from "node:assert/strict";
import { readWorkbook } from "../lib/sheet-read.mjs";
import { classifyRoleColumn, classifyRows, cleanRows, prepareTable, resolveRoleValues, roleKey } from "../lib/people-import.mjs";
import { workbook } from "./xlsx-fixture.mjs";

// Spreadsheets as people really keep them, each no more than ten fictional
// people, written without looking at how the importer works: titles above the
// headings, no headings, names surname first in capitals, everything in one
// cell, links behind names, a heading row above each group. Each test says
// what a recruiter would expect to end up with.

const csv = (text) => Buffer.from(text);
const none = () => ({ byMember: new Map(), byUrl: new Map(), byEmail: new Map(), suppressed: new Set() });

function read(bytes, options = {}, roles = []) {
  const { sheets } = readWorkbook(bytes);
  const table = prepareTable(sheets, options);
  const roleColumn = table.mapping.indexOf("role");
  let roleAs = options.roleAs ?? null;
  let roleDecision = null;
  if (roleColumn >= 0) {
    roleDecision = classifyRoleColumn({ header: table.header[roleColumn], values: table.body.map((row) => row.cells[roleColumn] ?? ""), roles, people: table.body.length });
    if (!roleAs && roleDecision.decision === "role") roleAs = "role";
  }
  const cleaned = table.needsName ? [] : cleanRows(table.body, table.header, table.mapping, {
    swapNames: options.swapNames ?? table.style.swap,
    fixCase: options.fixCase ?? table.style.fixCase,
    keepOther: options.keepOther ?? true,
    nameFromEmail: table.nameFromEmail,
    roleAs,
  });
  const { rows, totals } = classifyRows(cleaned, none());
  const people = rows.filter((row) => row.status === "new");
  return { table, roleDecision, rows, totals, people, names: people.map((row) => row.name) };
}

test("a title and notes above the headings are skipped, and the headings are found", () => {
  const { table, people } = read(csv("Candidate tracker - Q3 2026\nOwner: Sam\n\nName,LinkedIn,Current Title,Status\nJane Doe,linkedin.com/in/janedoe,Staff Engineer,Interviewed\nTom Lee,https://www.linkedin.com/in/tomlee,PM,Rejected\n"));
  assert.equal(table.headerRow, 2);
  assert.deepEqual(people.map((p) => [p.name, p.profileUrl, p.headline, p.other]), [
    ["Jane Doe", "https://www.linkedin.com/in/janedoe", "Staff Engineer", "Status: Interviewed"],
    ["Tom Lee", "https://www.linkedin.com/in/tomlee", "PM", "Status: Rejected"],
  ]);
});

test("a file with no headings is read from the first row, columns known by what is in them", () => {
  const { table, people } = read(csv("Jane Doe,https://linkedin.com/in/janedoe,jane@example.test,Leeds\nTom Lee,https://linkedin.com/in/tomlee,tom@example.test,York\nAmy Wu,https://linkedin.com/in/amywu,amy@example.test,Hull\n"));
  assert.equal(table.headerRow, -1);
  assert.equal(people.length, 3);
  assert.deepEqual([people[0].name, people[0].profileUrl, people[0].email, people[0].other], ["Jane Doe", "https://www.linkedin.com/in/janedoe", "jane@example.test", "Column D: Leeds"]);
});

test("a single column of names with no heading is a list of people", () => {
  const { table, names } = read(csv("Jane Doe\nTom Lee\nAmy Wu\n"));
  assert.equal(table.headerRow, -1);
  assert.deepEqual(names, ["Jane Doe", "Tom Lee", "Amy Wu"]);
});

test("SURNAME, First is turned round and written normally, particles kept", () => {
  const { names, table } = read(csv('Name,Email\n"SMITH, Jane",jane@example.test\n"O\'NEILL, Patrick",pat@example.test\n"van der BERG, Anna",anna@example.test\n'));
  assert.equal(table.style.swap, true);
  assert.deepEqual(names, ["Jane Smith", "Patrick O'Neill", "Anna van der Berg"]);
  assert.deepEqual(read(csv('Name,Email\n"SMITH, Jane",jane@example.test\n'), { swapNames: false, fixCase: false }).names, ["SMITH, Jane"]);
});

test("a name followed by a qualification is not mistaken for surname first", () => {
  const { names, table } = read(csv('Name\n"Jane Doe, PhD"\n"Tom Lee"\n"Amy Wu, MBA"\n'));
  assert.equal(table.style.swap, false);
  assert.deepEqual(names, ["Jane Doe, PhD", "Tom Lee", "Amy Wu, MBA"]);
});

test("names in one script without capitals are left alone", () => {
  const { names, table } = read(csv("姓名,邮箱,职位,城市\n张伟,zhang@example.test,工程师,上海\n李娜,li@example.test,产品经理,北京\n"));
  assert.equal(table.style.fixCase, false);
  assert.deepEqual(names, ["张伟", "李娜"]);
  assert.deepEqual(table.mapping, ["fullName", "email", "headline", "location"]);
});

test("first and last, city and country, numbered skills, title and company and two note columns are combined", () => {
  const { people } = read(csv("First,Last,City,Country,Skill 1,Skill 2,Company,Job Title,Notes,Notes\nJane,Doe,Leeds,UK,Go,SQL,Acme,Staff Engineer,Met at meetup,Wants remote\nTom,Lee,York,UK,Python,,Halden,PM,,\n"));
  assert.deepEqual(people.map((p) => [p.name, p.location, p.skills, p.headline]), [["Jane Doe", "Leeds, UK", "Go, SQL", "Staff Engineer at Acme"], ["Tom Lee", "York, UK", "Python", "PM at Halden"]]);
  assert.equal(people[0].notes, "Notes: Met at meetup\nNotes: Wants remote");
});

test("a profile linked from the name, or behind a cell that says View, is found", () => {
  const file = workbook([{
    name: "People",
    rows: [["Name", "Profile", "Title"], ["Jane Doe", "View", "Engineer"], ["Tom Lee", "View", "PM"], ["Amy Wu", "", "Designer"]],
    links: { A2: "https://www.linkedin.com/in/janedoe", B3: "https://uk.linkedin.com/in/tomlee/", A4: "https://www.linkedin.com/in/amywu?trk=x" },
  }]);
  const { people } = read(file);
  assert.deepEqual(people.map((p) => p.profileUrl), ["https://www.linkedin.com/in/janedoe", "https://www.linkedin.com/in/tomlee", "https://www.linkedin.com/in/amywu"]);
  assert.deepEqual(people.map((p) => p.warnings), [[], [], []]);
});

test("HYPERLINK formulas give their address, not the word shown", () => {
  const file = workbook([{ name: "S", rows: [["Name", "Profile"], ["Jane Doe", { formula: 'HYPERLINK("https://www.linkedin.com/in/janedoe","LinkedIn")', value: "LinkedIn" }]] }]);
  assert.equal(read(file).people[0].profileUrl, "https://www.linkedin.com/in/janedoe");
});

test("LinkedIn addresses written every which way come out the same", () => {
  const { people } = read(csv("Candidate,Link\nA One,uk.linkedin.com/in/aone\nB Two,https://www.linkedin.com/in/btwo/details/experience/\nC Three,LinkedIn: linkedin.com/in/cthree\nD Four,https://github.com/dfour\n"));
  assert.deepEqual(people.map((p) => p.profileUrl), ["https://www.linkedin.com/in/aone", "https://www.linkedin.com/in/btwo", "https://www.linkedin.com/in/cthree", "https://github.com/dfour"]);
});

test("a link column with an unknown heading is recognised by its contents", () => {
  const { table } = read(csv("Who,In,Where\nJane Doe,linkedin.com/in/janedoe,Leeds\nTom Lee,linkedin.com/in/tomlee,York\nAmy Wu,linkedin.com/in/amywu,Hull\n"));
  assert.deepEqual(table.mapping, ["fullName", "profileUrl", "location"]);
});

test("a heading row above each group becomes their role, never a person, and is asked about", () => {
  const file = csv("Name,LinkedIn,Notes\nSenior Data Engineer,,\nJane Doe,linkedin.com/in/janedoe,strong\nTom Lee,linkedin.com/in/tomlee,\nPlatform Lead,,\nAmy Wu,linkedin.com/in/amywu,\nBen Ode,linkedin.com/in/benode,maybe\n");
  const asked = read(file);
  assert.equal(asked.table.groupOn, true);
  assert.equal(asked.roleDecision.decision, "ask");
  assert.deepEqual(asked.names, ["Jane Doe", "Tom Lee", "Amy Wu", "Ben Ode"]);
  const answered = read(file, { roleAs: "role" });
  assert.deepEqual(answered.people.map((p) => p.roles), [["Senior Data Engineer"], ["Senior Data Engineer"], ["Platform Lead"], ["Platform Lead"]]);
  assert.ok(read(file, { groupRows: false }).names.includes("Senior Data Engineer"), "turned off, those rows are people again");
});

test("a person with only a name, part way down, is not taken for a heading", () => {
  const { table, names } = read(csv("Name,Email\nJane Doe,jane@example.test\nTom Lee\nAmy Wu,amy@example.test\n"));
  assert.equal(table.groupOn, false);
  assert.deepEqual(names, ["Jane Doe", "Tom Lee", "Amy Wu"]);
});

test("a vacancy written once in merged cells reaches each person, and is read as roles without asking", () => {
  const file = workbook([{
    name: "Pipeline",
    rows: [["Name", "LinkedIn", "Vacancy"], ["Jane Doe", "linkedin.com/in/janedoe", "ML Engineer"], ["Tom Lee", "linkedin.com/in/tomlee", ""], ["Amy Wu", "linkedin.com/in/amywu", ""], ["Ben Ode", "linkedin.com/in/benode", "Data Lead"]],
    merges: ["C2:C4"],
  }]);
  const { roleDecision, people } = read(file);
  assert.equal(roleDecision.decision, "role");
  assert.deepEqual(people.map((p) => p.roles), [["ML Engineer"], ["ML Engineer"], ["ML Engineer"], ["Data Lead"]]);
});

test("one person on two rows for two roles is one person on both", () => {
  const { people, totals } = read(csv("Name,LinkedIn,Applied for\nJane Doe,linkedin.com/in/janedoe,ML Engineer\nJane Doe,https://www.linkedin.com/in/JaneDoe/,Data Lead\nTom Lee,linkedin.com/in/tomlee,ML Engineer\n"), { roleAs: "role" });
  assert.equal(totals.duplicate, 1);
  assert.deepEqual(people.map((p) => [p.name, p.roles]), [["Jane Doe", ["ML Engineer", "Data Lead"]], ["Tom Lee", ["ML Engineer"]]]);
});

test("a Role column of job titles in a new account is asked about, and answered as titles it becomes the headline", () => {
  const file = csv("Name,Role,Email\nJane Doe,CTO at Acme,jane@example.test\nTom Lee,Head of Data @ Foo,tom@example.test\nAmy Wu,Senior PM,amy@example.test\n");
  assert.equal(read(file).roleDecision.decision, "ask");
  const { people } = read(file, { roleAs: "headline" });
  assert.deepEqual(people.map((p) => [p.headline, p.roles, p.other]), [["CTO at Acme", [], null], ["Head of Data @ Foo", [], null], ["Senior PM", [], null]]);
});

test("the role question is skipped when most values are roles the account already has, never otherwise in a new account", () => {
  const roles = [{ title: "ML Engineer" }, { title: "Data Lead" }];
  const header = "Role";
  assert.equal(classifyRoleColumn({ header, values: ["ML engineer", "data lead", "Data Lead", "Painter"], roles, people: 4 }).decision, "role");
  assert.equal(classifyRoleColumn({ header, values: ["ML Engineer", "Data Lead"], roles: [], people: 2 }).decision, "ask");
  const many = Array.from({ length: 40 }, (_, i) => `Job ${i}`);
  assert.equal(classifyRoleColumn({ header: "Vacancy", values: many, roles: [], people: 40 }).decision, "ask", "more than ten new roles always asks");
  assert.equal(classifyRoleColumn({ header: "Vacancy", values: ["A role", "A role", "B role"], roles: [], people: 10 }).decision, "role");
});

test("each role named in the file: exact open role used, everything else waits for the recruiter with no role", () => {
  const roles = [
    { id: "r1", title: "Platform Lead", status: "open" },
    { id: "r2", title: "Data Engineer", status: "open" },
    { id: "r3", title: "Data Engineer", status: "open" },
    { id: "r4", title: "Designer", status: "closed" },
    { id: "r5", title: "Senior Data Scientist", status: "open" },
  ];
  const values = new Map(["platform lead", "data engineer", "designer", "sr data scientist", "ml engineer"].map((key) => [key, { label: key, people: 1 }]));
  const out = Object.fromEntries(resolveRoleValues(values, roles).map((value) => [value.key, [value.kind, value.choice, value.options.map((o) => o.value).slice(0, 4)]]));
  assert.deepEqual(out["platform lead"].slice(0, 2), ["match", "r1"]);
  assert.deepEqual(out["data engineer"], ["several", "none", ["none", "create", "r2", "r3"]]);
  assert.deepEqual(out["designer"], ["closed", "none", ["none", "create", "r4", "r1"]]);
  assert.deepEqual(out["sr data scientist"].slice(0, 2), ["near", "none"]);
  assert.equal(out["sr data scientist"][2][2], "r5");
  assert.deepEqual(out["ml engineer"].slice(0, 2), ["new", "none"]);
  const chosen = resolveRoleValues(values, roles, { "ml engineer": "create", "designer": "r4", "data engineer": "someone-elses-role" });
  assert.deepEqual(chosen.map((value) => value.choice), ["r1", "none", "r4", "none", "create"], "an unknown role id falls back to no role");
});

test("role names compare without case, spacing or punctuation", () => {
  assert.equal(roleKey("  Senior  Data-Engineer "), roleKey("senior data engineer"));
  assert.equal(roleKey("R&D Lead"), "r and d lead");
});

test("placeholders, a repeated heading row and a totals row are not people", () => {
  const { rows, names } = read(csv("Name,Email,DNC\nJane Doe,jane@example.test,N\nN/A,,\nTBC,tbc@example.test,\n-,,\nName,Email,DNC\nTom Lee,tom@example.test,yes - asked 3/9\nTotal: 2 candidates,,\n"));
  assert.deepEqual(names, ["Jane Doe", "Tom Lee"]);
  assert.equal(rows.filter((row) => row.status === "invalid").length, 5);
  assert.equal(rows.find((row) => row.name === "Tom Lee").doNotContact, true);
});

test("an instructions sheet first and a hidden sheet are passed over for the list", () => {
  const file = workbook([
    { name: "Read me", rows: [["How to use this tracker"], ["Fill in one row per person"]] },
    { name: "Candidates", rows: [["Full name", "Email"], ["Jane Doe", "jane@example.test"], ["Tom Lee", "tom@example.test"]] },
    { name: "Lists", hidden: true, rows: [["Name"], ["Not a person"]] },
  ]);
  const { sheets } = readWorkbook(file);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Read me", "Candidates"]);
  assert.deepEqual(read(file).names, ["Jane Doe", "Tom Lee"]);
  assert.deepEqual(read(file, { sheet: 0 }).table.needsName, true, "choosing the other sheet is possible and asks for a name column");
});

test("a European CSV: semicolons, Windows-1252 accents and a title line", () => {
  const file = Buffer.concat([Buffer.from("Kandidaten Liste\nName;E-Mail;Ort\nZo"), Buffer.from([0xeb]), Buffer.from(" M"), Buffer.from([0xfc]), Buffer.from("ller;zoe@example.test;Z"), Buffer.from([0xfc]), Buffer.from("rich\n")]);
  const { people, table } = read(file);
  assert.equal(table.headerRow, 1);
  assert.deepEqual([people[0].name, people[0].email], ["Zoë Müller", "zoe@example.test"]);
});

test("Excel's Unicode Text (UTF-16, tabs) reads like any other file", () => {
  const file = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Name\tLinkedIn\r\nJane Doe\tlinkedin.com/in/janedoe\r\n", "utf16le")]);
  assert.deepEqual(read(file).people.map((p) => [p.name, p.profileUrl]), [["Jane Doe", "https://www.linkedin.com/in/janedoe"]]);
});

test("a Contact column of email addresses is an email column, and names are read from the addresses", () => {
  const { table, people, rows } = read(csv("Contact,Phone\njane.doe@example.test,0777\ntom@example.test,0788\n"));
  assert.deepEqual(table.mapping, ["email", ""]);
  assert.equal(table.nameFromEmail, true);
  assert.deepEqual(people.map((p) => [p.name, p.email, p.warnings]), [["Jane Doe", "jane.doe@example.test", ["Name read from the email address"]], ["Tom", "tom@example.test", ["Name read from the email address"]]]);
  assert.equal(rows.length, 2);
});

test("everything in one cell: the name is the start, the address and email are still found", () => {
  const { people } = read(csv("Candidate info\nJane Doe - Staff Engineer - linkedin.com/in/janedoe\nTom Lee | PM | tom@example.test\nAmy Wu (Designer)\n"));
  assert.deepEqual(people.map((p) => [p.name, p.profileUrl, p.email]), [["Jane Doe", "https://www.linkedin.com/in/janedoe", null], ["Tom Lee", null, "tom@example.test"], ["Amy Wu", null, null]]);
});

test("work and personal email: the first is used and the other is kept in the note", () => {
  const { people } = read(csv("Name,E-mail (work),E-mail (personal),Phone 1\nJane Doe,,jane@home.test,0777\nTom Lee,tom@acme.test,tom@home.test,\n"));
  assert.deepEqual(people.map((p) => [p.email, p.other]), [["jane@home.test", "Phone 1: 0777"], ["tom@acme.test", "E-mail (personal): tom@home.test"]]);
});

test("the rest of a row is kept in the note unless the recruiter says not to", () => {
  const file = csv("Name,Salary,Status\nJane Doe,85k,Interviewed\n");
  assert.equal(read(file).people[0].other, "Salary: 85k\nStatus: Interviewed");
  assert.equal(read(file, { keepOther: false }).people[0].other, null);
});

test("a row the recruiter leaves out is not imported, and says so", () => {
  const { sheets } = readWorkbook(csv("Name\nJane Doe\nTom Lee\n"));
  const table = prepareTable(sheets);
  const { rows } = classifyRows(cleanRows(table.body, table.header, table.mapping), none(), new Set([3]));
  assert.deepEqual(rows.map((row) => [row.name, row.status]), [["Jane Doe", "new"], ["Tom Lee", "excluded"]]);
});
