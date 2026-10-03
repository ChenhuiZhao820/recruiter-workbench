import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  budgetFit,
  factsAreStale,
  hasFactFilters,
  matchTerms,
  parseMoney,
  parsePeopleFilters,
  rankMatches,
  readBudget,
  readDate,
  reviewCutoff,
  scorePerson,
  searchWords,
  suggestRevisitDate,
} from "../lib/talent.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const DAY = 86_400_000;

test("money and budgets are read the way recruiters type them", () => {
  assert.equal(parseMoney("85k"), 85000);
  assert.equal(parseMoney("£85,000"), 85000);
  assert.equal(parseMoney("92.5k"), 92500);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("lots"), null);
  const get = (values) => (name) => values[name] ?? null;
  assert.deepEqual(readBudget(get({ budgetMin: "95k", budgetMax: "80000", budgetCurrency: "" })), { budgetMin: 80000, budgetMax: 95000, budgetCurrency: "GBP" });
  assert.deepEqual(readBudget(get({ budgetCurrency: "eur" })), { budgetMin: null, budgetMax: null, budgetCurrency: null });
  assert.match(readBudget(get({ budgetMax: "about 90" })).error, /whole amounts/);
  assert.match(readBudget(get({ budgetMax: "90k", budgetCurrency: "pounds" })).error, /three-letter/);
});

test("a person scores on whole phrases and significant words, never inside other words", () => {
  const terms = matchTerms(["Kubernetes", "Infrastructure as code", "Go"], ["Site Reliability Engineer", "kubernetes"]);
  assert.deepEqual(terms, ["kubernetes", "infrastructure as code", "go", "site reliability engineer"]);
  assert.deepEqual(scorePerson("platform work on kubernetes and google cloud", terms), { score: 3, hits: ["kubernetes"] });
  const partial = scorePerson("ran site reliability for payments; infrastructure in terraform", terms);
  assert.equal(partial.score, 1 + 2);
  assert.deepEqual(partial.hits, ["infrastructure as code", "site reliability engineer"]);
  assert.equal(scorePerson("javascript developer", matchTerms(["Java"])).score, 0);
  assert.equal(scorePerson("go and rust", terms).hits.includes("go"), true);
});

test("the budget leaves out people above it, shows unknown salaries as unknown, and filters nothing without one", () => {
  const role = { budgetMax: 90000, budgetCurrency: "GBP" };
  assert.equal(budgetFit({ salaryMin: 95000 }, role), "over");
  assert.equal(budgetFit({ salaryMin: 85000, salaryMax: 100000 }, role), "fits");
  assert.equal(budgetFit({ salaryMin: null, salaryMax: 95000 }, role), "over");
  assert.equal(budgetFit({ salaryMin: null, salaryMax: null }, role), "unknown");
  assert.equal(budgetFit({ salaryMin: 85000, salaryCurrency: "EUR" }, role), "unknown");
  assert.equal(budgetFit({ salaryMin: 500000 }, { budgetMax: null }), "no_budget");
});

// A fixed, fictional database of 300 people with a known right answer: ten
// people who really fit a platform role, hidden among near misses and noise.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function database() {
  const random = seeded(20261002);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const noise = ["java", "javascript", "react", "salesforce", "sap", "accounting", "payroll", "figma", "seo", "python", "django", "excel", "logistics", "nursing", "kotlin", "swift", "php", "laravel", "tableau", "hr"];
  const near = ["kubernetes administration course", "terraform", "site reliability", "aws", "docker", "linux", "ansible", "azure"];
  const people = [];
  for (let i = 0; i < 290; i++) {
    const skills = [pick(noise), pick(noise), pick(noise)];
    // About one in five has one near-miss word, as real databases do.
    if (random() < 0.2) skills.push(pick(near));
    people.push({ id: `noise-${i}`, fullName: `Noise Person ${i}`, searchText: `noise person ${i} ${skills.join(" ")}`, salaryMin: 60000 + Math.floor(random() * 50) * 1000, salaryCurrency: "GBP", factsConfirmedAt: null });
  }
  const right = [
    "kubernetes terraform site reliability engineer on payments",
    "platform engineer kubernetes, terraform, aws",
    "site reliability engineer, kubernetes on-call lead",
    "kubernetes operators in go, terraform modules",
    "devops engineer: kubernetes, terraform, infrastructure as code",
    "kubernetes and terraform at scale; sre",
    "infrastructure as code with terraform; kubernetes clusters",
    "site reliability engineer, terraform, golang",
    "kubernetes platform team, go services",
    "terraform and kubernetes migration lead",
  ];
  right.forEach((text, i) => people.push({ id: `right-${i}`, fullName: `Right Person ${i}`, searchText: text, salaryMin: 80000 + i * 1000, salaryCurrency: "GBP", factsConfirmedAt: new Date(Date.now() - i * DAY) }));
  // Two strong matches who want more than the budget, and one with no salary.
  people.push({ id: "over-0", fullName: "Over Budget", searchText: "kubernetes terraform site reliability engineer go", salaryMin: 140000, salaryCurrency: "GBP", factsConfirmedAt: null });
  people.push({ id: "over-1", fullName: "Over Budget Two", searchText: "kubernetes terraform infrastructure as code", salaryMin: 120000, salaryCurrency: "GBP", factsConfirmedAt: null });
  people.push({ id: "unknown-0", fullName: "Salary Unknown", searchText: "kubernetes terraform go site reliability engineer", salaryMin: null, salaryMax: null, factsConfirmedAt: null });
  return people;
}

test("on 300 fictional people, the right people fill the top ten and the budget holds", () => {
  const terms = matchTerms(["Kubernetes", "Terraform", "Infrastructure as code", "Go"], ["Site Reliability Engineer", "Platform Engineer"]);
  const people = database();
  assert.equal(people.length, 303);

  const withBudget = rankMatches(people, terms, { budgetMax: 100000, budgetCurrency: "GBP" });
  const ids = withBudget.map((match) => match.person.id);
  assert.equal(ids.length, 10);
  const found = ids.filter((id) => id.startsWith("right-") || id === "unknown-0").length;
  // Recall of the planted answers in the top ten. Nine of ten is the bar.
  assert.ok(found >= 9, `top ten held ${found} right answers: ${ids.join(", ")}`);
  assert.equal(ids.some((id) => id.startsWith("over-")), false);
  assert.equal(withBudget.find((match) => match.person.id === "unknown-0")?.budget, "unknown");
  assert.equal(ids.some((id) => id.startsWith("noise-")), false);

  const noBudget = rankMatches(people, terms, { budgetMax: null }).map((match) => match.person.id);
  assert.ok(noBudget.includes("over-0"));
  assert.deepEqual(rankMatches(people, [], { budgetMax: null }), []);
});

test("people-search filters come from the address and ignore anything unreadable", () => {
  assert.deepEqual(parsePeopleFilters({ q: " Kubernetes Leeds ", salary: "90k", notice: "4", remote: "remote", rtw: "has_right", fresh: "6" }), {
    q: "Kubernetes Leeds", maxSalary: 90000, maxNotice: 4, remote: "remote", rightToWork: "has_right", freshMonths: 6,
  });
  const junk = parsePeopleFilters({ salary: "lots", notice: "-1", remote: "space", rtw: "yes", fresh: "5" });
  assert.equal(hasFactFilters(junk), false);
  assert.deepEqual(searchWords("  Kubernetes   in LEEDS a "), ["kubernetes", "in", "leeds"]);
});

test("revisit dates come from the candidate's own words; facts go stale after six months", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.equal(suggestRevisitDate("In about six months if this does not work out", now), "2027-04-02");
  assert.equal(suggestRevisitDate("try me again in 3 weeks", now), "2026-10-23");
  assert.equal(suggestRevisitDate("a couple of months", now), "2026-12-02");
  assert.equal(suggestRevisitDate("after Christmas", now), "2027-01-15");
  assert.equal(suggestRevisitDate("whenever", now), null);
  assert.equal(suggestRevisitDate(null, now), null);
  assert.equal(factsAreStale(new Date(now.getTime() - 200 * DAY), now), true);
  assert.equal(factsAreStale(new Date(now.getTime() - 100 * DAY), now), false);
  assert.equal(factsAreStale(null, now), false);
  assert.equal(reviewCutoff(now).toISOString(), "2025-10-02T12:00:00.000Z");
  assert.equal(readDate("2026-11-30")?.toISOString(), "2026-11-30T00:00:00.000Z");
  assert.equal(readDate("2026-02-30"), null);
  assert.equal(readDate("tomorrow"), null);
});

test("talent actions are behind their own features and scoped to the owner", () => {
  const actions = readFileSync(path.join(root, "app/actions/talent.ts"), "utf8");
  const bodies = Object.fromEntries(actions.split("export async function ").slice(1).map((body) => [body.match(/^\w+/)[0], body]));
  assert.deepEqual(Object.keys(bodies).sort(), ["addPersonToRole", "keepPerson", "setRevisit"]);
  assert.match(bodies.addPersonToRole, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("talentMatches"\);/);
  assert.match(bodies.setRevisit, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("revisitReminders"\);/);
  assert.match(bodies.keepPerson, /^\w+\([^)]*\)[^{]*\{\n  const user = await requireWritableFeature\("privacy"\);/);
  for (const body of Object.values(bodies)) assert.match(body, /userId: user\.id/);
});

test("the demo workspace has fifteen fictional candidates, one or two in every state, dated from today", async () => {
  const { demoPlan } = await import("../scripts/seed-demo.mjs");
  const now = new Date("2026-10-05T09:00:00Z");
  const plan = demoPlan(now);
  const candidacies = plan.people.flatMap((person) => person.roles.map(([, stage]) => ({ person, stage })));
  assert.equal(plan.roles.length, 3);
  assert.equal(plan.people.length, 14);
  assert.equal(candidacies.length, 15);
  const count = (stage) => candidacies.filter((c) => c.stage === stage).length;
  assert.ok(count("sourced") >= 2 && count("contacted") >= 2 && count("replied") >= 1);
  assert.equal(count("booked"), 2);
  assert.equal(count("screened"), 2);
  assert.equal(count("submitted"), 2);
  const bookings = plan.people.filter((person) => person.bookingAt).map((person) => person.bookingAt.getTime());
  assert.equal(bookings.length, 2);
  assert.ok(bookings.some((ms) => ms > now.getTime() && ms - now.getTime() < DAY));
  assert.ok(bookings.some((ms) => ms - now.getTime() > 6 * DAY));
  assert.equal(plan.people.filter((person) => person.quoteMissing?.length).length, 1);
  assert.equal(plan.people.filter((person) => person.revisitOn && person.revisitOn.getTime() - now.getTime() < 7 * DAY).length, 1);
  assert.ok(plan.people.some((person) => person.factsConfirmedAt && now.getTime() - person.factsConfirmedAt.getTime() > 183 * DAY));
  assert.equal(plan.people.filter((person) => person.doNotContact).length, 1);
  assert.equal(plan.people.filter((person) => person.roles.length === 2).length, 1);
  // Everyone is fictional: invented names and links that are never opened.
  for (const person of plan.people) assert.match(person.key, /^[a-z]+$/);
  assert.match(plan.templates[0].body, /\{\{booking_link\}\}/);
});
