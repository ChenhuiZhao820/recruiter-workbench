// Renders a message template. Missing values are left as a visible gap
// so the recruiter notices before pasting. So are placeholders we do not
// recognise: a typo like {{first_nane}} must not travel silently into a
// real message.

export const KNOWN_PLACEHOLDERS = [
  "first_name",
  "role_title",
  "calendar_link",
  "recruiter_name",
] as const;

export type PlaceholderValues = {
  first_name?: string;
  role_title?: string;
  calendar_link?: string;
  recruiter_name?: string;
};

// Any {{ token }}, known or not. Kept global so it can be reused with exec.
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function isKnown(name: string): boolean {
  return (KNOWN_PLACEHOLDERS as readonly string[]).indexOf(name) !== -1;
}


// --- Article agreement ------------------------------------------------------
//
// A template has to commit to "a" or "an" before it knows what will be
// substituted, so "a {{role_title}}" becomes "a Operations Director".
// English picks the article by the SOUND of the next word, not its first
// letter, so a plain vowel test would just trade one error for another
// ("an user", "a MBA"). Three rules, in order:
//
//   1. Initialisms are read letter by letter: "an MBA", but "a UX Designer".
//   2. Words whose spelling and sound disagree are listed explicitly.
//   3. Everything else falls back to the first letter.
//
// Numerals are deliberately not handled: "a 180" and "an 18" both occur and
// depend on how the number is read aloud. Job titles do not start with digits.

// Letters whose spoken name begins with a vowel sound: ay, ee, ef, aitch,
// eye, el, em, en, oh, ar, es, ex.
const VOWEL_SOUND_LETTERS = "AEFHILMNORSX";

// Vowel letter, consonant sound (the "yoo" and "wun" words).
const TAKES_A = [
  "university", "universities", "universal", "unit", "units", "unitary",
  "united", "uniform", "union", "unions", "unique", "user", "users", "usage",
  "usual", "usually", "utility", "utilities", "ubiquitous", "european",
  "euro", "euros", "eulogy", "one", "once", "one-off",
];

// Consonant letter, vowel sound (the silent-h words).
const TAKES_AN = [
  "hour", "hours", "hourly", "honest", "honesty", "honestly", "honour",
  "honours", "honoured", "honorary", "honor", "honors", "honored",
  "heir", "heiress", "heirloom",
];

export function needsAn(following: string): boolean {
  const match = following.match(/[A-Za-z][A-Za-z0-9'&-]*/);
  if (!match) return false;
  const word = match[0];

  const initialism = word.split(/[^A-Za-z]/)[0];
  if (/^[A-Z]+$/.test(initialism) && initialism.length <= 5 && !/[aeiou]/.test(initialism.slice(1))) {
    return VOWEL_SOUND_LETTERS.indexOf(initialism.charAt(0)) !== -1;
  }

  const lower = word.toLowerCase();
  if (TAKES_A.indexOf(lower) !== -1) return false;
  if (TAKES_AN.indexOf(lower) !== -1) return true;
  return "aeiou".indexOf(lower.charAt(0)) !== -1;
}

// Keeps the capitalisation of the article the template author wrote.
function articleLike(original: string, following: string): string {
  const word = needsAn(following) ? "an" : "a";
  return /^[A-Z]/.test(original) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// "a" or "an" immediately before a placeholder - the only place where the
// template author could not have known which one to write.
const ARTICLE_BEFORE_TOKEN = /\b([Aa]n?)(\s+)\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substitute(name: string, values: PlaceholderValues): string {
  if (!isKnown(name)) return `[UNKNOWN: ${name}]`;
  const value = values[name as keyof PlaceholderValues];
  return value && value.trim() ? value.trim() : `[MISSING: ${name}]`;
}

// --- whitespace -------------------------------------------------------------
//
// A message leaves this app to be pasted into a box somebody else wrote, and
// whitespace that reads as nothing here is visible there: a gap above the
// greeting, a hole between two short paragraphs, a trailing space that makes a
// line look wrong when it wraps. None of it is deliberate - it comes from
// editing a template, from a pasted draft, or from a placeholder that turned
// out shorter than the line it was written into - so it is removed before the
// text is copied, counted or recorded.
//
// What is deliberate is kept. A single newline still breaks a line, so bullets
// and short lines survive, and one blank line still separates paragraphs. Only
// runs longer than that are shortened, because nobody means three blank lines.
// Runs of spaces inside a line are left alone too: indentation and alignment
// are things people mean, and this is not the place to second-guess them.

// What a paste drags in. None of it is typed and none of it is visible, which
// is exactly why it survives being looked at: a line holding one non-breaking
// space reads as blank but is not blank, so it escapes the blank-line rule and
// becomes the extra gap that had to be deleted by hand on the other side.
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;
// Every space Unicode has that is not the space bar: the non-breaking one Word
// and LinkedIn paste, and the narrow ones that come out of PDFs.
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
// Line and paragraph separators, which are newlines everywhere except to a
// regular expression that has only been told about \n and \r.
const ODD_BREAKS = /[\u2028\u2029]/g;

export function normalizeMessage(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(ODD_SPACES, " ")
    .replace(ODD_BREAKS, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderTemplate(body: string, values: PlaceholderValues): string {
  // Fill the gaps that follow an article first, correcting the article to
  // agree with whatever actually landed there.
  const withArticles = body.replace(
    ARTICLE_BEFORE_TOKEN,
    (_match, article: string, gap: string, name: string) => {
      const filled = substitute(name, values);
      // A [MISSING] or [UNKNOWN] marker is not a word to agree with, and the
      // message is blocked anyway, so leave the article as written.
      if (filled.charAt(0) === "[") return `${article}${gap}${filled}`;
      return `${articleLike(article, filled)}${gap}${filled}`;
    }
  );
  return normalizeMessage(withArticles.replace(TOKEN, (_match, name: string) => substitute(name, values)));
}

// Placeholder names in a template body that this app cannot fill in.
export function unknownPlaceholders(body: string): string[] {
  const found: string[] = [];
  const re = new RegExp(TOKEN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    if (!isKnown(name) && found.indexOf(name) === -1) found.push(name);
  }
  return found;
}

// True when a rendered message still has holes in it, of either kind.
export function hasGaps(rendered: string): boolean {
  return rendered.indexOf("[MISSING:") !== -1 || rendered.indexOf("[UNKNOWN:") !== -1;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

// Patterns for highlighting placeholders in a template body. Built from
// KNOWN_PLACEHOLDERS so the Templates page cannot drift out of step with
// what renderTemplate actually fills in.
const PLACEHOLDER_GROUP =
  "\\{\\{\\s*(?:" + KNOWN_PLACEHOLDERS.join("|") + ")\\s*\\}\\}";

export function placeholderSplitPattern(): RegExp {
  return new RegExp("(" + PLACEHOLDER_GROUP + ")", "g");
}

export function isKnownPlaceholder(text: string): boolean {
  return new RegExp("^" + PLACEHOLDER_GROUP + "$").test(text);
}
