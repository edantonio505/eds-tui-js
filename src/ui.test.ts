import { test } from "node:test";
import assert from "node:assert/strict";
import { displayModel } from "./ui.js";

test("displayModel: strips a trailing :cloud tag", () => {
  assert.equal(displayModel("deepseek-v4-pro:cloud"), "deepseek-v4-pro");
  assert.equal(displayModel("kimi-k3:cloud"), "kimi-k3");
});

test("displayModel: leaves other tags (and untagged names) alone", () => {
  assert.equal(displayModel("qwen3.8:latest"), "qwen3.8:latest");
  assert.equal(displayModel("qwen3-coder:30b"), "qwen3-coder:30b");
  assert.equal(displayModel("ornith:35b"), "ornith:35b");
  assert.equal(displayModel("some-model-with-no-tag"), "some-model-with-no-tag");
});

test("displayModel: only strips :cloud at the very end, not a look-alike substring earlier in the name", () => {
  assert.equal(displayModel("cloudy-model:8b"), "cloudy-model:8b");
});
