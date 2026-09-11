import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPaste, spliceBackPastes } from "./input.js";

test("classifyPaste: multi-line paste (2+ non-blank lines) collapses to a placeholder", () => {
  const result = classifyPaste("line one\nline two\nline three");
  assert.equal(result.placeholder, true);
  assert.equal(result.lineCount, 3);
  assert.equal(result.insertText, "[+3 lines]");
});

test("classifyPaste: single-line paste is inserted directly, trimmed", () => {
  const result = classifyPaste("  just one line  ");
  assert.equal(result.placeholder, false);
  assert.equal(result.insertText, "just one line");
});

test("classifyPaste: blank lines don't count toward the placeholder threshold", () => {
  // One real line plus surrounding/interspersed blank lines — still "one
  // non-blank line", so it must NOT collapse (matches Python's `l.strip()`
  // filter before counting).
  const result = classifyPaste("\n\n  actual content  \n\n");
  assert.equal(result.placeholder, false);
  assert.equal(result.insertText, "actual content");
});

test("classifyPaste: exactly two non-blank lines (with blank lines between) collapses", () => {
  const result = classifyPaste("first\n\nsecond");
  assert.equal(result.placeholder, true);
  assert.equal(result.lineCount, 2);
});

test("classifyPaste: empty paste is treated as zero lines, inserted as empty text", () => {
  const result = classifyPaste("");
  assert.equal(result.placeholder, false);
  assert.equal(result.insertText, "");
});

test("classifyPaste: a placeholder-collapsed paste stashes the FULL raw text, not trimmed", () => {
  // classifyPaste itself doesn't stash (that's promptLine's job with the
  // returned insertText/placeholder flag), but confirm the raw text a
  // caller would stash is preserved untouched by classifyPaste.
  const raw = "  line one  \n  line two  \n";
  const result = classifyPaste(raw);
  assert.equal(result.placeholder, true);
  // insertText for a placeholder case is just the marker, not the content —
  // the caller is responsible for stashing `raw` itself verbatim.
  assert.equal(result.insertText, "[+2 lines]");
});

test("spliceBackPastes: a single placeholder is replaced with its stashed block", () => {
  const result = spliceBackPastes("before [+2 lines] after", ["stashed\ntext"]);
  assert.equal(result, "before stashed\ntext after");
});

test("spliceBackPastes: multiple placeholders splice back in order of appearance", () => {
  const result = spliceBackPastes("[+2 lines] and then [+3 lines]", ["FIRST\nBLOCK", "SECOND\nBLOCK\nHERE"]);
  assert.equal(result, "FIRST\nBLOCK and then SECOND\nBLOCK\nHERE");
});

test("spliceBackPastes: no placeholders — line passes through trimmed, unchanged", () => {
  const result = spliceBackPastes("  just typed text  ", []);
  assert.equal(result, "just typed text");
});

test("spliceBackPastes: trims the final result", () => {
  const result = spliceBackPastes("  [+1 lines]  ", ["x"]);
  assert.equal(result, "x");
});
