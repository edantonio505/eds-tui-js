import { test } from "node:test";
import assert from "node:assert/strict";
import { clipOutput, MAX_OUTPUT_CHARS } from "./clip.js";

test("output at or under the cap passes through unchanged", () => {
  const s = "x".repeat(MAX_OUTPUT_CHARS);
  assert.equal(clipOutput(s), s);
});

test("huge output is clipped with a note, mirrors the Python self-check", () => {
  const big = "x".repeat(500_000);
  const clipped = clipOutput(big);
  assert.ok(clipped.length < MAX_OUTPUT_CHARS + 500, `expected < ${MAX_OUTPUT_CHARS + 500}, got ${clipped.length}`);
  assert.match(clipped, /characters cut/);
});

test("clipped output keeps the real head and tail content", () => {
  const head = "HEAD_MARKER".repeat(1000); // > 6000 chars of markers
  const tail = "TAIL_MARKER".repeat(200); // > 1500 chars of markers
  const middle = "m".repeat(20_000);
  const big = head + middle + tail;
  const clipped = clipOutput(big);
  assert.ok(clipped.startsWith(head.slice(0, 6000)));
  assert.ok(clipped.endsWith(tail.slice(-1500)));
});

test("dropped/total counts use thousands separators, matching Python's {:,} formatting", () => {
  const big = "x".repeat(500_000);
  const clipped = clipOutput(big);
  assert.match(clipped, /500,000 characters/);
});
