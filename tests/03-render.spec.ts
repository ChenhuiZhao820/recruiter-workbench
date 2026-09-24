import { test, expect } from "@playwright/test";
import {
  KNOWN_PLACEHOLDERS,
  isKnownPlaceholder,
  needsAn,
  normalizeMessage,
  placeholderSplitPattern,
  renderTemplate,
  unknownPlaceholders,
} from "../lib/render";
import {
  CONNECTION_NOTE_LIMIT,
  isTemplateKind,
  limitForKind,
  templateKindLabel,
} from "../lib/templates";

// Pure-function tests: no browser, no database. These cover the article rule
// densely, which would be slow and pointless to do through the UI.

const BODY = "I'm hiring for a {{role_title}} and thought of you.";

function render(roleTitle: string): string {
  return renderTemplate(BODY, {
    first_name: "Sam",
    role_title: roleTitle,
    calendar_link: "https://cal.example/x",
  });
}

test.describe("article agreement before a placeholder", () => {
  const takesAn = [
    "Operations Director",
    "Account Manager",
    "Engineering Lead",
    "Insight Analyst",
    "Underwriter",
    "Office Manager",
    // Initialisms read letter by letter: em-bee-ay, aitch-ar, eye-tee, es-ee-oh.
    "MBA Programme Lead",
    "HR Business Partner",
    "IT Manager",
    "SEO Specialist",
    "NHS Contracts Manager",
    "R&D Director",
    "L&D Manager",
    // Silent h.
    "Honorary Trustee",
    "Hour Desk Supervisor",
  ];
  for (const title of takesAn) {
    test(`"an ${title}"`, () => {
      expect(render(title)).toContain(`for an ${title} and`);
    });
  }

  const takesA = [
    "Plant Director",
    "Head of Operations",
    "Sales Manager",
    // Vowel letter, consonant sound.
    "University Lecturer",
    "Unit Manager",
    "Uniform Standards Lead",
    "User Researcher",
    "European Sales Lead",
    "One-off Project Lead",
    // Initialisms whose first letter is read with a consonant sound.
    "UX Designer",
    "CTO",
    "PMO Analyst",
    "B2B Marketer",
  ];
  for (const title of takesA) {
    test(`"a ${title}"`, () => {
      expect(render(title)).toContain(`for a ${title} and`);
    });
  }
});

test("an article written as 'an' is corrected downwards too", () => {
  const body = "We need an {{role_title}} urgently.";
  expect(renderTemplate(body, { role_title: "Plant Director" })).toBe(
    "We need a Plant Director urgently."
  );
});

test("capitalisation of the author's article is kept", () => {
  const body = "A {{role_title}} is what we need.";
  expect(renderTemplate(body, { role_title: "Operations Director" })).toBe(
    "An Operations Director is what we need."
  );
});

test("a word merely ending in 'a' is not treated as an article", () => {
  const body = "Extra {{role_title}} needed. Anna {{first_name}} referred you.";
  const out = renderTemplate(body, { role_title: "Ops Lead", first_name: "Sam" });
  expect(out).toBe("Extra Ops Lead needed. Anna Sam referred you.");
});

test("an unfilled gap leaves the article alone and stays visible", () => {
  const out = renderTemplate("Grab a time: a {{calendar_link}}", {});
  expect(out).toBe("Grab a time: a [MISSING: calendar_link]");
});

test("an unknown placeholder is marked and does not move the article", () => {
  const out = renderTemplate("You are a {{seniority}} hire.", {});
  expect(out).toBe("You are a [UNKNOWN: seniority] hire.");
  expect(unknownPlaceholders("You are a {{seniority}} hire.")).toEqual(["seniority"]);
});

test("needsAn handles the letter-name rule directly", () => {
  for (const word of ["MBA", "HR", "IT", "SEO", "FTE", "NHS", "R&D"]) {
    expect(needsAn(word), word).toBe(true);
  }
  for (const word of ["UX", "CTO", "PM", "B2B", "KPI"]) {
    expect(needsAn(word), word).toBe(false);
  }
});

test("recruiter_name is a real placeholder, filled from Settings", () => {
  const body = "Hi {{first_name}}, best regards, {{recruiter_name}}";
  expect(renderTemplate(body, { first_name: "Sam", recruiter_name: "Alex Recruiter" })).toBe(
    "Hi Sam, best regards, Alex Recruiter"
  );
  // Blank behaves like any other unfilled gap rather than vanishing.
  expect(renderTemplate(body, { first_name: "Sam", recruiter_name: "   " })).toBe(
    "Hi Sam, best regards, [MISSING: recruiter_name]"
  );
  expect(unknownPlaceholders(body)).toEqual([]);
});

test("the highlight patterns stay in step with what is actually filled", () => {
  for (const name of KNOWN_PLACEHOLDERS) {
    expect(isKnownPlaceholder(`{{${name}}}`), name).toBe(true);
    expect(isKnownPlaceholder(`{{ ${name} }}`), name).toBe(true);
  }
  expect(isKnownPlaceholder("{{company}}")).toBe(false);
  expect("Hi {{first_name}} from {{recruiter_name}}".split(placeholderSplitPattern())).toEqual([
    "Hi ",
    "{{first_name}}",
    " from ",
    "{{recruiter_name}}",
    "",
  ]);
});

test("a connection note is capped, a message is not", () => {
  expect(limitForKind("connection_note")).toBe(CONNECTION_NOTE_LIMIT);
  expect(limitForKind("message")).toBeNull();
  expect(templateKindLabel("connection_note")).toBe("Connection note");
  expect(templateKindLabel("message")).toBe("Message");
  expect(isTemplateKind("connection_note")).toBe(true);
  expect(isTemplateKind("carrier_pigeon")).toBe(false);
});

test.describe("whitespace a recruiter would otherwise delete by hand", () => {
  test("the message starts at the first word and ends at the last", () => {
    expect(normalizeMessage("\n\n  Hi Sam,\n\nBest,\nAlex\n   \n\n")).toBe("Hi Sam,\n\nBest,\nAlex");
  });

  test("nobody means three blank lines", () => {
    expect(normalizeMessage("One.\n\n\nTwo.")).toBe("One.\n\nTwo.");
    expect(normalizeMessage("One.\n\n\n\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  test("one blank line between paragraphs is left exactly as written", () => {
    const body = "Hi Sam,\n\nI'm hiring for an Ops Director.\n\nBest,\nAlex";
    expect(normalizeMessage(body)).toBe(body);
  });

  test("a list is not collapsed into a paragraph", () => {
    const body = "Two things:\n- Based in Leeds\n- Reports to the MD\n\nWorth a chat?";
    expect(normalizeMessage(body)).toBe(body);
  });

  test("trailing spaces go, indentation stays", () => {
    expect(normalizeMessage("Hi Sam,   \n- one   \n  - nested\n")).toBe("Hi Sam,\n- one\n  - nested");
  });

  test("a pasted Windows draft arrives with one kind of line ending", () => {
    expect(normalizeMessage("Hi Sam,\r\n\r\nBest,\r\nAlex")).toBe("Hi Sam,\n\nBest,\nAlex");
    expect(normalizeMessage("Hi Sam,\r\r\rBest")).toBe("Hi Sam,\n\nBest");
  });

  test("a blank-looking line that is not blank is still a blank line", () => {
    // The gap a paste leaves behind: a line holding one non-breaking space.
    // It reads as empty, so it escapes the blank-line rule and survives every
    // hand-deletion of "the extra space that keeps coming back".
    expect(normalizeMessage("Hi Sam,\u00a0\n\u00a0\nBest")).toBe("Hi Sam,\n\nBest");
    expect(normalizeMessage("Hi Sam,\u00a0\u00a0\nBest")).toBe("Hi Sam,\nBest");
  });

  test("an odd space is a space, not a character of the message", () => {
    // Narrow and ideographic spaces come out of PDFs and out of Word.
    expect(normalizeMessage("Ops\u2009Director")).toBe("Ops Director");
    expect(normalizeMessage("Ops\u3000Director")).toBe("Ops Director");
  });

  test("characters nobody can see are not carried into the message", () => {
    // A zero-width space inside a word, and a byte-order mark in front of it.
    expect(normalizeMessage("\ufeffOps\u200bDirector")).toBe("OpsDirector");
    expect(normalizeMessage("Hi\u200d Sam").length).toBe("Hi Sam".length);
  });

  test("a line separator is a line break like any other", () => {
    expect(normalizeMessage("One.\u2028Two.")).toBe("One.\nTwo.");
    expect(normalizeMessage("One.\u2029\u2029\u2029Two.")).toBe("One.\n\nTwo.");
  });

  test("runs of spaces inside a line are left where they were put", () => {
    // Alignment and indentation are meant; this is not the place to argue.
    const body = "Name:    Sam\nRole:    Ops Director";
    expect(normalizeMessage(body)).toBe(body);
  });

  test("a message of nothing but whitespace is nothing", () => {
    // markAsSent refuses an empty body, so this cannot be recorded as sent.
    expect(normalizeMessage(" \n\t\r\n  ")).toBe("");
  });

  test("a rendered message is tidied before it is copied, counted or recorded", () => {
    const body = "\nHi {{first_name}},\n\n\n\nI'm hiring for a {{role_title}}.   \n\n";
    const rendered = renderTemplate(body, { first_name: "Sam", role_title: "Ops Director" });
    expect(rendered).toBe("Hi Sam,\n\nI'm hiring for an Ops Director.");
    // The count the connection-note limit is judged by is the tidied one.
    expect(rendered.length).toBeLessThan(body.length);
  });

  test("tidying never disturbs a gap marker", () => {
    expect(renderTemplate("Grab a time:\n\n\n{{calendar_link}}", {})).toBe(
      "Grab a time:\n\n[MISSING: calendar_link]"
    );
  });
});

test("placeholders change the length that actually matters", () => {
  // The template fits; the rendered message for a real candidate does not.
  const body = "Hi {{first_name}}, ".padEnd(CONNECTION_NOTE_LIMIT - 10, "x");
  expect(body.length).toBeLessThan(CONNECTION_NOTE_LIMIT);
  const rendered = renderTemplate(body, { first_name: "Bartholomew-Fitzgerald" });
  expect(rendered.length).toBeGreaterThan(body.length);
});
