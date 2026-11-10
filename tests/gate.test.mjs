import { test } from "node:test";
import assert from "node:assert/strict";
import { findHardViolations, wordCountOffBudget } from "../src/lib/build/gate.js";

const types = (text) => findHardViolations(text).map((v) => v.type);

test("clean prose passes", () => {
  assert.deepEqual(findHardViolations("Plain sentences, a comma, a colon: and a full stop. Pages 12-14 are fine."), []);
});

test("the em dash family is caught", () => {
  assert.deepEqual(types("One thing — another."), ["em dash"]);
  assert.deepEqual(types("One thing ― another."), ["em dash"]);
  assert.deepEqual(types("One thing ‒ another."), ["em dash"]);
});

test("an en dash is allowed in a number range and refused as a dash", () => {
  assert.deepEqual(findHardViolations("Chapters 3–5 cover it."), []);
  assert.deepEqual(types("Wait – what?"), ["en dash used as a dash"]);
});

test("hyphen stand-ins for a dash are caught, real hyphens are not", () => {
  assert.ok(types("It worked --- mostly.").includes("triple hyphen"));
  assert.ok(types("It worked -- mostly.").includes("double hyphen between words"));
  assert.ok(types("It worked - mostly.").includes("spaced hyphen used as a dash"));
  assert.deepEqual(findHardViolations("A well-known, state-of-the-art, long-term plan."), []);
});

test("leftover markers are caught", () => {
  assert.deepEqual(types("Revenue grew [VERIFY: 40%]."), ["unresolved VERIFY/CHECK marker"]);
  assert.deepEqual(types("TODO write this."), ["TODO marker"]);
  assert.deepEqual(types("Dear [INSERT name]"), ["placeholder brackets"]);
});

test("banned machine-voice phrases are caught whole-word and case-insensitively", () => {
  assert.deepEqual(types("Let us Delve into it."), ["banned machine-voice phrase"]);
  const found = findHardViolations("A rich tapestry of ideas.");
  assert.equal(found.length, 1);
  assert.equal(found[0].match, "tapestry");
});

test("a banned word inside a longer word is not a violation", () => {
  // "robust" is banned; "robustly" and a word that merely contains a banned one must not trip the gate.
  assert.deepEqual(findHardViolations("It held up robustly."), []);
  assert.deepEqual(findHardViolations("Packed into a toolkit for the road."), []);
});

test("every violation reports its surrounding context", () => {
  const [v] = findHardViolations("Before the problem started. This is seamless and neat. After.");
  assert.equal(v.match, "seamless");
  assert.match(v.context, /This is seamless and neat/);
});

test("word count is off budget only beyond 20 percent", () => {
  assert.equal(wordCountOffBudget(2500, 2500), false);
  assert.equal(wordCountOffBudget(3000, 2500), false); // exactly 20 percent over
  assert.equal(wordCountOffBudget(3001, 2500), true);
  assert.equal(wordCountOffBudget(2000, 2500), false); // exactly 20 percent under
  assert.equal(wordCountOffBudget(1999, 2500), true);
  assert.equal(wordCountOffBudget(100, 0), false); // no budget means nothing to compare
});
