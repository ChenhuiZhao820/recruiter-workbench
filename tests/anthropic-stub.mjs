// Local stand-in for the Anthropic API so E2E tests never hit the real
// service. The app's SDK client honors ANTHROPIC_BASE_URL, which the
// Playwright config points at this server.
import http from "node:http";

let calls = 0;

function briefing(callNumber) {
  return {
    day_to_day: `They run daily production operations, chase supplier delays, and keep the plant hitting its numbers. (stub call #${callNumber})`,
    key_skills: [
      { skill: "Lean manufacturing", real_vs_buzzword: "Real: names the line they improved and the cycle-time drop. Buzzword: just lists 'Lean/Six Sigma'." },
      { skill: "P&L ownership", real_vs_buzzword: "Real: quotes budget size. Buzzword: 'commercially aware'." },
      { skill: "Team leadership", real_vs_buzzword: "Real: team sizes and structures. Buzzword: 'strong leader'." },
      { skill: "Supply chain", real_vs_buzzword: "Real: names ERP systems. Buzzword: 'end-to-end supply chain'." },
      { skill: "Health and safety", real_vs_buzzword: "Real: cites incident-rate changes. Buzzword: 'safety culture'." },
    ],
    search_titles: ["Operations Director", "Head of Operations", "Plant Director"],
    target_companies: ["Mid-size manufacturers", "Automotive tier-1 suppliers"],
    salary_range: "£75k to £95k",
    first_call_questions: [
      { question: "Walk me through a shift that went wrong.", strong_answer: "Specific incident, actions, numbers.", weak_answer: "Generic talk about staying calm." },
      { question: "What did you change in your first 90 days?", strong_answer: "Concrete changes with measured results.", weak_answer: "Vague culture talk." },
      { question: "How big was your budget?", strong_answer: "A number and what it covered.", weak_answer: "Doesn't know or dodges." },
      { question: "Who did you report to and who reported to you?", strong_answer: "Clear org picture.", weak_answer: "Fuzzy on structure." },
    ],
  };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      calls += 1;
      // A role titled BADJSON makes the stub answer with prose instead of
      // JSON, so tests can exercise the parse-failure and retry path.
      const text = body.includes("BADJSON")
        ? "Sure! Here's a briefing for that role: they mostly run operations."
        : JSON.stringify(briefing(calls));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        })
      );
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
});

server.listen(8766, () => console.log("anthropic stub listening on 8766"));
