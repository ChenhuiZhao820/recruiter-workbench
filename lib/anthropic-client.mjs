// Headers every Anthropic client in Capture sends. An API key that is not
// scoped to a workspace must name one on each request; ANTHROPIC_WORKSPACE_ID
// does that. A workspace-scoped key needs nothing, and the variable stays empty.
const WORKSPACE_ID = /^wrkspc_[A-Za-z0-9]+$/;

export function anthropicHeaders(env = process.env) {
  const id = String(env.ANTHROPIC_WORKSPACE_ID ?? "").trim();
  if (!id) return {};
  if (!WORKSPACE_ID.test(id)) throw new Error("ANTHROPIC_WORKSPACE_ID must look like wrkspc_… as shown on the Console's Workspaces page.");
  return { "anthropic-workspace-id": id };
}
