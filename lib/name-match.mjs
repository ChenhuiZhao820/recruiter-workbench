// Finding a candidate on a role page by name, forgivingly: case, accents and
// punctuation are ignored, a word may be typed in part ("jo smi"), the parts
// in any order, with a slip of a letter or two ("jonh smtih"), or run together
// ("janesmith"). Plain code, shared with tests/name-match.test.mjs; it reads
// names only and decides nothing but what the list shows.

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Optimal string alignment distance: insertions, deletions, substitutions and
// one swap of neighbours, which is the usual typing slip.
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Short words must be typed right; longer ones may carry a slip or two.
function slipsAllowed(token) {
  return token.length >= 6 ? 2 : token.length >= 4 ? 1 : 0;
}

function tokenMatchesWord(token, word) {
  if (word.includes(token)) return true;
  const allowed = slipsAllowed(token);
  if (!allowed) return false;
  // Against the whole word, and against its start for a word typed in part.
  if (editDistance(token, word) <= allowed) return true;
  const start = word.slice(0, token.length);
  return start.length === token.length && editDistance(token, start) <= allowed;
}

export function nameMatches(query, name) {
  const q = normalizeName(query);
  if (!q) return true;
  const n = normalizeName(name);
  if (!n) return false;
  const words = n.split(" ");
  if (q.split(" ").every((token) => words.some((word) => tokenMatchesWord(token, word)))) return true;
  // Typed without the space: "janesmith".
  const compactQuery = q.replace(/ /g, "");
  return compactQuery.length >= 3 && n.replace(/ /g, "").includes(compactQuery);
}

// Names compared as people read them: accents and case set aside, numbers in
// their own order.
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
export function compareNames(a, b) {
  return collator.compare(String(a ?? "").trim(), String(b ?? "").trim());
}
