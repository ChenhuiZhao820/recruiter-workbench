import Anthropic from "@anthropic-ai/sdk";
import { SCREENING_SCHEMA, SYSTEM_PROMPT, checkEvidence, parseScreening, screeningUserText } from "./screening-core.mjs";

// One screening, one model call (plus one retry if the reply is not the
// agreed shape). Shared by the app and scripts/eval-screening.mjs so the
// evaluation measures exactly what recruiters get.

// Until the evaluation picks one, the current Opus. Set CAPTURE_SCREENING_MODEL
// to change it; nothing else in the app names a model.
export const DEFAULT_SCREENING_MODEL = "claude-opus-5-5";

// Models that take the server-side refusal fallback: if a safety check
// declines a call, the API reruns it on a model chosen by category instead of
// failing the recruiter's request.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
// Haiku 4.5 rejects the effort setting.
const takesEffort = (model) => !model.startsWith("claude-haiku-");

export class ScreeningRefusedError extends Error {}
export class ScreeningShapeError extends Error {}

export function screeningModel(env = process.env) {
  return env.CAPTURE_SCREENING_MODEL?.trim() || DEFAULT_SCREENING_MODEL;
}

export function buildScreeningRequest({ model, roleTitle, client, keySkills, transcript, cvBase64, effort }) {
  const content = [];
  if (cvBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cvBase64 } });
  content.push({ type: "text", text: screeningUserText({ roleTitle, client, keySkills, transcript, hasCv: Boolean(cvBase64) }) });
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: {
      format: { type: "json_schema", schema: SCREENING_SCHEMA },
      ...(effort && EFFORTS.has(effort) && takesEffort(model) ? { effort } : {}),
    },
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

// Returns the checked result: every value either carries a quote found in the
// transcript or is marked quote_missing. Throws ScreeningRefusedError or
// ScreeningShapeError; API and network errors propagate as the SDK's own.
export async function summariseScreening({ apiKey, model, roleTitle, client, keySkills, transcript, cvBase64, effort = process.env.CAPTURE_SCREENING_EFFORT }) {
  // Only for a key that is not scoped to a workspace (the paid eval runs).
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const anthropic = new Anthropic({ apiKey, maxRetries: 2, ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}) });
  const params = buildScreeningRequest({ model, roleTitle, client, keySkills, transcript, cvBase64, effort });
  const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.beta.messages.create(params);
    usage.calls += 1;
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    if (response.stop_reason === "refusal") throw new ScreeningRefusedError("The model declined this transcript.");
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    const parsed = response.stop_reason === "max_tokens" ? null : parseScreening(text);
    if (parsed) return { result: checkEvidence(parsed, transcript), model: response.model ?? model, usage };
  }
  throw new ScreeningShapeError("The summary came back in a shape that could not be read.");
}
