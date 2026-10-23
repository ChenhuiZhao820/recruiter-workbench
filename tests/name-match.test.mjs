import test from "node:test";
import assert from "node:assert/strict";
import { compareNames, nameMatches, normalizeName } from "../lib/name-match.mjs";

test("names are compared without case, accents or punctuation", () => {
  assert.equal(normalizeName("  Zoë O'Brien-Ångström "), "zoe o brien angstrom");
  assert.ok(nameMatches("zoe", "Zoë Ångström"));
  assert.ok(nameMatches("obrien", "Siobhán O'Brien"));
  assert.ok(nameMatches("ANGSTROM", "Zoë Ångström"));
});

test("parts of words, in any order, all have to be there", () => {
  assert.ok(nameMatches("jo smi", "Jonathan Smith"));
  assert.ok(nameMatches("smith jon", "Jonathan Smith"));
  assert.ok(nameMatches("than", "Jonathan Smith"));
  assert.ok(!nameMatches("jo brown", "Jonathan Smith"));
});

test("a slip of a letter or two still finds them, but short words must be right", () => {
  assert.ok(nameMatches("jonh", "John Mercer"));
  assert.ok(nameMatches("smtih", "Jonathan Smith"));
  assert.ok(nameMatches("pemberton ade", "Saoirse Pembertn-Ade"));
  assert.ok(nameMatches("saorise", "Saoirse Kelly"));
  assert.ok(!nameMatches("ann", "Ian Bell"));
  assert.ok(!nameMatches("mercer", "Marcus Webb"));
});

test("a name typed without its space is found, and nothing typed shows everyone", () => {
  assert.ok(nameMatches("janesmith", "Jane Smith"));
  assert.ok(nameMatches("", "Anyone"));
  assert.ok(nameMatches("   ", "Anyone"));
  assert.ok(!nameMatches("x", ""));
});

test("A to Z ignores case and accents and reads numbers as numbers", () => {
  const names = ["zoe Adams", "Émile Brun", "anna Clark", "Candidate 10", "Candidate 2"];
  assert.deepEqual([...names].sort(compareNames), ["anna Clark", "Candidate 2", "Candidate 10", "Émile Brun", "zoe Adams"]);
});
