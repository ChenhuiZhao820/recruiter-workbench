"use server";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

type BriefingJson = {
  day_to_day: string;
  key_skills: { skill: string; real_vs_buzzword: string }[];
  search_titles: string[];
  target_companies: string[];
  salary_range: string;
  first_call_questions: { question: string; strong_answer: string; weak_answer: string }[];
};

const PROMPT = (title: string, jobDesc: string) => `You are helping a recruiter prepare to source candidates for a role. Read the job title and description below, then return a briefing as a single JSON object.

Job title: ${title}

Job description:
${jobDesc}

Return exactly this JSON shape and nothing else. No markdown fences, no preamble, no trailing text:

{
  "day_to_day": "one short paragraph, in plain words, describing what this person actually does all day",
  "key_skills": [
    { "skill": "string", "real_vs_buzzword": "how to tell genuine experience from buzzwords on a profile" }
  ],
  "search_titles": ["job titles these people also go by"],
  "target_companies": ["kinds of companies where they tend to work"],
  "salary_range": "typical pay range, for example '£65k to £85k'",
  "first_call_questions": [
    { "question": "string", "strong_answer": "what a strong answer sounds like", "weak_answer": "what a vague answer sounds like" }
  ]
}

Give five or six key_skills and four to six first_call_questions. Write for a busy recruiter who is not technical: plain, direct, no jargon.`;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseBriefing(text: string): BriefingJson | null {
  try {
    const parsed = JSON.parse(stripFences(text));
    if (
      typeof parsed.day_to_day === "string" &&
      Array.isArray(parsed.key_skills) &&
      Array.isArray(parsed.search_titles) &&
      Array.isArray(parsed.target_companies) &&
      typeof parsed.salary_range === "string" &&
      Array.isArray(parsed.first_call_questions)
    ) {
      return parsed as BriefingJson;
    }
    return null;
  } catch {
    return null;
  }
}

async function callModel(title: string, jobDesc: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: PROMPT(title, jobDesc) }],
  });
  const block = response.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

export async function generateBriefing(
  roleId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "No API key is set on the server. Add ANTHROPIC_API_KEY to the .env file and restart.",
    };
  }
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) return { ok: false, error: "Role not found." };
  if (!role.jobDesc?.trim()) {
    return { ok: false, error: "Add a job description to this role first, then try again." };
  }

  let briefing: BriefingJson | null = null;
  try {
    // Try once, and retry once on malformed JSON.
    for (let attempt = 0; attempt < 2 && !briefing; attempt++) {
      briefing = parseBriefing(await callModel(role.title, role.jobDesc));
    }
  } catch {
    return { ok: false, error: "The briefing service could not be reached. Try again in a moment." };
  }
  if (!briefing) {
    return { ok: false, error: "The briefing came back in a shape we could not read. Try again." };
  }

  await db.briefing.upsert({
    where: { roleId },
    update: {
      dayToDay: briefing.day_to_day,
      keySkills: JSON.stringify(briefing.key_skills),
      searchTitles: JSON.stringify(briefing.search_titles),
      targetCompanies: JSON.stringify(briefing.target_companies),
      salaryRange: briefing.salary_range,
      firstCallQuestions: JSON.stringify(briefing.first_call_questions),
    },
    create: {
      roleId,
      dayToDay: briefing.day_to_day,
      keySkills: JSON.stringify(briefing.key_skills),
      searchTitles: JSON.stringify(briefing.search_titles),
      targetCompanies: JSON.stringify(briefing.target_companies),
      salaryRange: briefing.salary_range,
      firstCallQuestions: JSON.stringify(briefing.first_call_questions),
    },
  });

  revalidatePath(`/roles/${roleId}`);
  return { ok: true };
}
