import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, SafeError } from "./bootstrap-admin.mjs";
import { guardPaidRun, logPaidRun } from "./paid-run.mjs";

// One real Enrow email search by LinkedIn address, to learn whether this API
// account may search that way before the email finder is built on it. It
// reads the credit balance (free), starts one search (at most 1 credit: 1 if
// an email is found, 0.25 if not, 0 if Enrow fails) and polls its result
// (free). Like every paid run it prints an estimate and stops unless
// approved, runs at most once a day, never in CI, and is logged - with the
// outcome and the credits only, never the address searched or the email.
//
//   node --env-file=<.env with ENROW_API_KEY> scripts/enrow-probe.mjs --linkedin <PROFILE_URL>
//   ... --approve-cost --reason "check LinkedIn search is enabled for the API"

const API = "https://api.enrow.io";
// The Start plan is 1,000 credits for 15 EUR; one credit is about 0.02 USD.
const USD_PER_CREDIT = 0.02;
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 60000;

// Enough to recognise the address, not enough to reproduce it.
export function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function enrow(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-api-key": process.env.ENROW_API_KEY, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON body is reported as null */ }
  return { status: response.status, body };
}

// The balance fields only: the account reply may also carry who owns it.
function credits(body) {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(Object.entries(body).filter(([key]) => /credit/i.test(key)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["--linkedin", "--approve-cost", "--reason", "--again-today"], ["--approve-cost", "--again-today"]);
  if (!args["--linkedin"]) throw new SafeError("Give the --linkedin profile address to search.");
  if (!process.env.ENROW_API_KEY) throw new SafeError("ENROW_API_KEY is not set. Pass it with node --env-file=<file>.");
  const reason = guardPaidRun({ script: "enrow-probe", estimateUsd: USD_PER_CREDIT, args });

  const before = await enrow("/account/info");
  console.log(JSON.stringify({ step: "account", status: before.status, credits: credits(before.body) }));
  if (before.status === 401) throw new SafeError("Enrow refused the API key (401).");

  const started = await enrow("/email/find/single", { method: "POST", body: JSON.stringify({ linkedin_url: args["--linkedin"] }) });
  console.log(JSON.stringify({ step: "start", status: started.status, message: started.body?.message ?? started.body?.reason ?? null, creditsUsed: started.body?.credits_used ?? null }));
  if (started.status !== 200 && started.status !== 201) {
    // Refused before a search existed: nothing was spent, so the day is not used up.
    console.log("LinkedIn search was refused for this account. Enrow's message is above.");
    return;
  }

  const id = started.body?.id;
  let result = null;
  for (const deadline = Date.now() + POLL_FOR_MS; Date.now() < deadline;) {
    await new Promise((done) => setTimeout(done, POLL_EVERY_MS));
    const polled = await enrow(`/email/find/single?id=${encodeURIComponent(id)}`);
    if (polled.status === 202 || polled.body?.qualification === "ongoing") continue;
    result = polled;
    break;
  }
  const outcome = result
    ? {
        status: result.status,
        qualification: result.body?.qualification ?? null,
        linkedinStatus: result.body?.linkedin_status ?? null,
        creditsUsed: result.body?.credits_used ?? null,
        email: maskEmail(result.body?.email),
        companyFound: Boolean(result.body?.info?.company_domain || result.body?.info?.company_name),
      }
    : { timedOut: true };
  console.log(JSON.stringify({ step: "result", ...outcome }));

  const after = await enrow("/account/info");
  console.log(JSON.stringify({ step: "account", status: after.status, credits: credits(after.body) }));
  logPaidRun({ script: "enrow-probe", reason, ...(args["--again-today"] ? { repeatToday: true } : {}), qualification: outcome.qualification ?? null, linkedinStatus: outcome.linkedinStatus ?? null, creditsUsed: outcome.creditsUsed ?? null, timedOut: Boolean(outcome.timedOut) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SafeError ? error.message : error);
    process.exit(1);
  });
}
