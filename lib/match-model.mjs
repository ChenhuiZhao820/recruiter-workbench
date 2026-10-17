import Anthropic from "@anthropic-ai/sdk";
import { anthropicHeaders } from "./anthropic-client.mjs";
import { CRITERIA_SCHEMA, MATCH_SYSTEM_PROMPT, briefUserText, parseCriteriaText, refineUserText } from "./match-core.mjs";

// The one model call in Instant Match: a brief, or the current criteria and a
// sentence of change, in; criteria out. No person record is ever part of it.
// One retry if the reply is not the agreed shape.

// Reading a brief is extraction, so the smallest current model does it. Set
// CAPTURE_MATCH_MODEL to change it; nothing else in the app names this model.
export const DEFAULT_MATCH_MODEL = "claude-haiku-5-5";

// Haiku 4.5 rejects the effort setting; every later model takes it.
const takesEffort = (model) => !model.startsWith("claude-haiku-4");

export class MatchRefusedError extends Error {}
export class MatchShapeError extends Error {}

export function matchModel(env = process.env) {
  return env.CAPTURE_MATCH_MODEL?.trim() || DEFAULT_MATCH_MODEL;
}

/** @param {{ model: string, brief?: string, criteria?: any, instruction?: string }} args */
export function buildMatchRequest({ model, brief, criteria, instruction }) {
  const text = criteria ? refineUserText(criteria, instruction) : briefUserText(brief);
  return {
    model,
    max_tokens: 4000,
    system: MATCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
    output_config: {
      format: { type: "json_schema", schema: CRITERIA_SCHEMA },
      ...(takesEffort(model) ? { effort: "low" } : {}),
    },
  };
}

// Criteria, cleaned. Throws MatchRefusedError or MatchShapeError; API and
// network errors propagate as the SDK's own.
// onUsage, when given, hears each response's token counts (the evaluation
// script prices its run with it); the app does not pass it.
/** @param {{ apiKey?: string, model: string, brief?: string, criteria?: any, instruction?: string, onUsage?: (usage: any) => void }} args */
export async function readCriteria({ apiKey, model, brief, criteria = null, instruction = "", onUsage }) {
  const anthropic = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000, defaultHeaders: anthropicHeaders() });
  const params = buildMatchRequest({ model, brief, criteria, instruction });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.beta.messages.create(params);
    onUsage?.(response.usage);
    if (response.stop_reason === "refusal") throw new MatchRefusedError("The model declined this brief.");
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    const parsed = response.stop_reason === "max_tokens" ? null : parseCriteriaText(text, criteria);
    if (parsed) return parsed;
  }
  throw new MatchShapeError("The criteria came back in a shape that could not be read.");
}
