import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The library is TypeScript, so the test works against the vendored table and a
// small re-implementation would be a lie. Instead it checks the data itself and
// the one thing a demo can get wrong quietly: the shape of what is stored.
const table = JSON.parse(readFileSync(new URL("../lib/linkedin-industries.json", import.meta.url)));

test("the vendored taxonomy is LinkedIn's, whole and unique", () => {
  assert.equal(table.length, 434);
  assert.equal(new Set(table.map((i) => i.id)).size, table.length);
  for (const entry of table) {
    assert.match(entry.id, /^\d+$/);
    assert.ok(entry.label.length > 0 && entry.path.length > 0);
  }
});

test("the ids LinkedIn's own filters use are present and correct", () => {
  const byLabel = new Map(table.map((i) => [i.label, i.id]));
  assert.equal(byLabel.get("Software Development"), "4");
  assert.equal(byLabel.get("Banking"), "41");
  assert.equal(byLabel.get("Manufacturing"), "25");
});
