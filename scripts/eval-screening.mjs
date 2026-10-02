import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, SafeError } from "./bootstrap-admin.mjs";
import { costUsd, guardPaidRun, logPaidRun } from "./paid-run.mjs";
import { FACT_FIELDS, normalizeTranscript, scoreField } from "../lib/screening-core.mjs";
import { summariseScreening } from "../lib/screening-model.mjs";

// Scores the screening assistant against a fixture set with known answers,
// through exactly the request the app sends. Runs only when the plan allows
// one (choosing the model, a prompt or output change, a model change, before
// release), never in CI, at most once a day, and only with --approve-cost.
//
//   node scripts/eval-screening.mjs --models claude-haiku-4-5,claude-sonnet-5-5,claude-opus-5-5
//   node scripts/eval-screening.mjs --models claude-opus-5-5 --approve-cost --reason "choose the model"
//   --fixtures <dir>   another set with the same answers.json shape, such as
//                      consented real calls kept in prisma/private-local/

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(root, "prisma", "private-local", "screening-evals");

function loadSet(dir) {
  const answersFile = join(dir, "answers.json");
  if (!existsSync(answersFile)) throw new SafeError(`No answers.json in ${dir}. Generate the set first: node scripts/make-synthetic-screenings.mjs`);
  const answers = JSON.parse(readFileSync(answersFile, "utf8"));
  return answers.map((entry) => ({ ...entry, transcript: normalizeTranscript(readFileSync(join(dir, entry.file), "utf8")) }));
}

function summarise(model, rows) {
  const fields = rows.flatMap((row) => row.fields);
  const withValue = fields.filter((field) => !field.got.not_discussed);
  const perField = Object.fromEntries(FACT_FIELDS.map((name) => {
    const these = fields.filter((field) => field.name === name);
    return [name, `${these.filter((field) => field.correct).length}/${these.length}`];
  }));
  return {
    model,
    transcripts: rows.length,
    failed: rows.filter((row) => row.error).length,
    accuracy: `${fields.filter((field) => field.correct).length}/${fields.length}`,
    perField,
    invented: fields.filter((field) => field.invented).length,
    quotesFound: `${withValue.filter((field) => !field.got.quote_missing).length}/${withValue.length}`,
    costUsd: Number(rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0).toFixed(3)),
    secondsPerCall: Number((rows.reduce((sum, row) => sum + row.seconds, 0) / Math.max(rows.length, 1)).toFixed(1)),
  };
}

function lastBaseline(model) {
  if (!existsSync(RESULTS)) return null;
  const files = readdirSync(RESULTS).filter((file) => file.endsWith(`-${model}.json`)).sort();
  return files.length ? JSON.parse(readFileSync(join(RESULTS, files[files.length - 1]), "utf8")).summary : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--models", "--fixtures", "--approve-cost", "--reason"], ["--approve-cost"]);
  const models = String(args["--models"] ?? "").split(",").map((model) => model.trim()).filter(Boolean);
  if (!models.length) throw new SafeError("Name the model or models: --models claude-haiku-4-5,claude-sonnet-5-5,claude-opus-5-5");
  const set = loadSet(resolve(args["--fixtures"] ?? join(root, "tests", "fixtures", "screening")));
  const inputPerCall = Math.ceil(Math.max(...set.map((row) => row.transcript.length)) / 3.5) + 1_500;
  let estimate = 0;
  for (const model of models) {
    // Two calls per transcript in the worst case (one retry), 2,000 output tokens each.
    const cost = costUsd(model, set.length * 2 * inputPerCall, set.length * 2 * 2_000);
    if (cost === null) throw new SafeError(`No price on file for ${model}; add it to scripts/paid-run.mjs first.`);
    estimate += cost;
  }
  const reason = guardPaidRun({ script: "eval-screening", estimateUsd: estimate, args });
  if (!process.env.ANTHROPIC_API_KEY) throw new SafeError("Set ANTHROPIC_API_KEY for this terminal.");

  mkdirSync(RESULTS, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  let spent = 0;
  const report = [];
  try {
    for (const model of models) {
      const rows = [];
      for (const entry of set) {
        const started = Date.now();
        try {
          const { result, usage } = await summariseScreening({ apiKey: process.env.ANTHROPIC_API_KEY, model, roleTitle: entry.role, transcript: entry.transcript, effort: process.env.CAPTURE_SCREENING_EFFORT });
          const cost = costUsd(model, usage.input_tokens, usage.output_tokens) ?? 0;
          spent += cost;
          rows.push({
            file: entry.file,
            seconds: (Date.now() - started) / 1000,
            costUsd: cost,
            fields: FACT_FIELDS.map((name) => ({ name, got: result[name], expected: entry.expected[name], ...scoreField(name, result[name], entry.expected[name]) })),
          });
        } catch (error) {
          rows.push({ file: entry.file, seconds: (Date.now() - started) / 1000, error: error.constructor.name, fields: [] });
        }
      }
      const summary = summarise(model, rows);
      const previous = lastBaseline(model);
      writeFileSync(join(RESULTS, `${day}-${model}.json`), JSON.stringify({ reason, summary, rows }, null, 2), { mode: 0o600 });
      report.push({ ...summary, previous });
    }
  } finally {
    logPaidRun({ script: "eval-screening", models, reason, costUsd: Number(spent.toFixed(3)), transcripts: set.length });
  }
  for (const line of report) console.log(JSON.stringify(line));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : `Evaluation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
