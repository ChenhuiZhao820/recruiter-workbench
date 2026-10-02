import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SafeError } from "./bootstrap-admin.mjs";

// The spending guard shared by the scripts that call a paid model. A run
// prints its estimate and stops unless --approve-cost is given with a
// --reason; it refuses a second run of the same script on the same day and
// never runs in CI; every run is appended to a log in prisma/private-local/
// so how often money was spent stays visible.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RUN_LOG = join(root, "prisma", "private-local", "paid-model-runs.jsonl");

// US dollars per million tokens, input and output. Check against the current
// price list before relying on an estimate.
export const PRICES = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
  "claude-fable-5-1": [10, 50],
};

export function costUsd(model, inputTokens, outputTokens) {
  const price = PRICES[model];
  if (!price) return null;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

function runsToday(script, today) {
  if (!existsSync(RUN_LOG)) return 0;
  return readFileSync(RUN_LOG, "utf8").split("\n").filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((entry) => entry && entry.script === script && String(entry.at).slice(0, 10) === today).length;
}

export function guardPaidRun({ script, estimateUsd, args }) {
  console.log(JSON.stringify({ script, estimatedCostUsd: Number(estimateUsd.toFixed(2)) }));
  if (process.env.CI) throw new SafeError("Paid model runs never run in CI.");
  if (!args["--approve-cost"]) throw new SafeError("Not started. Re-run with --approve-cost and --reason \"...\" once the estimate above is approved.");
  const reason = String(args["--reason"] ?? "").trim();
  if (!reason) throw new SafeError("Give the --reason for this run (for example: choose the model, prompt changed, model retired, pre-release).");
  const today = new Date().toISOString().slice(0, 10);
  if (runsToday(script, today) > 0) throw new SafeError(`${script} already ran today; one paid run a day. See ${RUN_LOG}.`);
  return reason;
}

export function logPaidRun(entry) {
  mkdirSync(dirname(RUN_LOG), { recursive: true });
  appendFileSync(RUN_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
}
