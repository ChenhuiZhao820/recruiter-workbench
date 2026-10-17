import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { parseArgs, SafeError } from "./bootstrap-admin.mjs";
import { costUsd, guardPaidRun, logPaidRun } from "./paid-run.mjs";
import { normalise, requirementLabels } from "../lib/match-core.mjs";
import { matchModel, readCriteria } from "../lib/match-model.mjs";

// Scores Instant Match's one model call - a brief read into criteria, and a
// sentence of change applied to them - against fictional briefs with known
// right answers, through exactly the request the app sends. Like every paid
// run it prints an estimate and stops unless approved, runs at most once a
// day, never in CI, and is logged.
//
//   node scripts/eval-match.mjs
//   node --env-file=<.env with ANTHROPIC_API_KEY> scripts/eval-match.mjs --approve-cost --reason "..."
//   --model <id>     another model than CAPTURE_MATCH_MODEL or the default
//   --again-today    a second run the same day, to check a fix the first found

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(root, "tests", "fixtures", "match", "briefs.json");
const RESULTS = join(root, "prisma", "private-local", "match-evals");

const has = (skills, alternatives) => skills.some((skill) =>
  [skill.name, ...skill.also].some((name) => alternatives.some((alt) => normalise(name).includes(normalise(alt)))));

// Field by field: right when the criteria hold one of the accepted answers.
export function scoreCriteria(expect, got) {
  const checks = [];
  const check = (field, ok, expected, actual) => checks.push({ field, ok, expected, got: actual });
  for (const group of expect.mustAll ?? []) check(`must ${group[0]}`, has(got.must, group), group, got.must.map((s) => s.name));
  for (const word of expect.mustNone ?? []) check(`not must ${word}`, !has(got.must, [word]), `not ${word}`, got.must.map((s) => s.name));
  for (const group of expect.niceAll ?? []) check(`nice ${group[0]}`, has(got.nice, group), group, got.nice.map((s) => s.name));
  for (const word of expect.niceNone ?? []) check(`not nice ${word}`, !has(got.nice, [word]), `not ${word}`, got.nice.map((s) => s.name));
  for (const word of expect.uncheckedNone ?? []) {
    check(`not unchecked ${word}`, !got.unchecked.some((item) => normalise(item).includes(normalise(word))), `not ${word}`, got.unchecked);
  }
  for (const group of expect.uncheckedAny ?? []) {
    check(`unchecked ${group[0]}`, got.unchecked.some((item) => group.some((alt) => normalise(item).includes(normalise(alt)))), group, got.unchecked);
  }
  const value = {
    salaryMax: got.salaryMax, currency: got.currency, noticeMax: got.noticeMax, pattern: got.pattern,
    rtw: got.rtw, senMin: got.senMin, senMax: got.senMax,
    location: got.location ? [got.location.name, ...got.location.also].join(" / ") : null,
  };
  for (const field of ["salaryMax", "currency", "noticeMax", "pattern", "rtw", "senMin", "senMax"]) {
    if (expect[field]) check(field, expect[field].includes(value[field]), expect[field], value[field]);
  }
  if (expect.location) {
    const ok = expect.location.some((place) => place === null ? value.location === null : value.location !== null && normalise(value.location).includes(normalise(place)));
    check("location", ok, expect.location, value.location);
  }
  return checks;
}

function describe(criteria) {
  return {
    title: criteria.title,
    must: criteria.must.map((s) => (s.also.length ? `${s.name} (${s.also.join(", ")})` : s.name)),
    nice: criteria.nice.map((s) => s.name),
    titles: criteria.titles,
    requirements: requirementLabels(criteria).map((label) => label.text),
    unchecked: criteria.unchecked,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--model", "--approve-cost", "--reason", "--again-today"], ["--approve-cost", "--again-today"]);
  const model = String(args["--model"] ?? matchModel());
  const set = JSON.parse(readFileSync(FIXTURES, "utf8"));
  const calls = set.briefs.length + set.adjustments.length;
  // Generous: a long brief, the schema and prompt, and room for thinking.
  const estimate = costUsd(model, calls * 3_000, calls * 3_000);
  if (estimate === null) throw new SafeError(`No price on record for ${model}; add it to scripts/paid-run.mjs first.`);
  const reason = guardPaidRun({ script: "eval-match", estimateUsd: estimate, args });
  if (!process.env.ANTHROPIC_API_KEY) throw new SafeError("ANTHROPIC_API_KEY is not set for this run.");
  // The local stub listens on ANTHROPIC_BASE_URL in tests; a score against it
  // would measure nothing, so only the real API is accepted.
  const base = process.env.ANTHROPIC_BASE_URL;
  if (base && new URL(base).host !== "api.anthropic.com") throw new SafeError("ANTHROPIC_BASE_URL points somewhere other than the Anthropic API; unset it for this run.");

  const usage = { input: 0, output: 0, calls: 0 };
  const onUsage = (u) => { usage.calls += 1; usage.input += u?.input_tokens ?? 0; usage.output += u?.output_tokens ?? 0; };
  const rows = [];
  const read = new Map();
  const run = async (id, request, expect) => {
    const started = Date.now();
    try {
      const criteria = await readCriteria({ apiKey: process.env.ANTHROPIC_API_KEY, model, onUsage, ...request });
      const checks = scoreCriteria(expect, criteria);
      rows.push({ id, seconds: (Date.now() - started) / 1000, checks, criteria: describe(criteria) });
      return criteria;
    } catch (error) {
      // A key or account problem fails every call the same way: stop at the
      // first one rather than sending the whole set to be refused.
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || (error instanceof Anthropic.BadRequestError && usage.calls === 0)) {
        throw new SafeError(`The API refused the first request, so nothing else was sent and nothing was spent: ${error.message}`);
      }
      rows.push({ id, seconds: (Date.now() - started) / 1000, error: error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error), checks: [] });
      return null;
    }
  };
  for (const entry of set.briefs) read.set(entry.id, await run(entry.id, { brief: entry.brief }, entry.expect));
  for (const entry of set.adjustments) {
    const start = read.get(entry.from);
    if (!start) { rows.push({ id: entry.id, error: `skipped: ${entry.from} failed`, checks: [], seconds: 0 }); continue; }
    await run(entry.id, { criteria: start, instruction: entry.instruction }, entry.expect);
  }

  const checks = rows.flatMap((row) => row.checks);
  const spent = costUsd(model, usage.input, usage.output);
  const summary = {
    model,
    briefs: set.briefs.length,
    adjustments: set.adjustments.length,
    failedCalls: rows.filter((row) => row.error).length,
    accuracy: `${checks.filter((c) => c.ok).length}/${checks.length}`,
    misses: rows.flatMap((row) => row.checks.filter((c) => !c.ok).map((c) => ({ id: row.id, field: c.field, expected: c.expected, got: c.got }))),
    tokens: usage,
    costUsd: Number(spent.toFixed(4)),
    secondsPerCall: Number((rows.reduce((sum, row) => sum + row.seconds, 0) / Math.max(rows.length, 1)).toFixed(1)),
  };
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, `${new Date().toISOString().slice(0, 10)}-${model}.json`);
  writeFileSync(file, JSON.stringify({ reason, summary, rows }, null, 2), { mode: 0o600 });
  // A run that reached no model spent nothing and is not counted against the day.
  if (usage.calls > 0) logPaidRun({ script: "eval-match", models: [model], reason, ...(args["--again-today"] ? { repeatToday: true } : {}), costUsd: summary.costUsd, briefs: set.briefs.length, adjustments: set.adjustments.length });
  for (const row of rows) {
    const ok = row.checks.filter((c) => c.ok).length;
    console.log(`\n${row.id}  ${row.error ? `ERROR ${row.error}` : `${ok}/${row.checks.length}`}  ${row.seconds.toFixed(1)}s`);
    if (row.criteria) console.log(JSON.stringify(row.criteria));
    for (const c of row.checks.filter((c) => !c.ok)) console.log(`  miss ${c.field}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.got)}`);
  }
  console.log(`\n${JSON.stringify({ ...summary, misses: summary.misses.length })}\nFull results: ${file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : error);
    process.exit(1);
  });
}
