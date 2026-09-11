import { test } from "node:test";
import assert from "node:assert/strict";
import { pickModels } from "./client.js";

test("prefers the desired main/small names when the relay actually has them", () => {
  const { main, small } = pickModels(
    ["ornith:35b", "qwen3.8:latest", "llama3.2:3b"],
    "qwen3.8:latest",
    "ornith:35b"
  );
  assert.equal(main, "qwen3.8:latest");
  assert.equal(small, "ornith:35b");
});

test("falls back to the first available name when the desired main isn't present", () => {
  const { main } = pickModels(["llama3.2:3b", "mistral:7b"], "qwen3.8:latest", "ornith:35b");
  assert.equal(main, "llama3.2:3b");
});

test("falls back to a remaining name (excluding main) when the desired small isn't present", () => {
  const { main, small } = pickModels(["llama3.2:3b", "mistral:7b"], "llama3.2:3b", "ornith:35b");
  assert.equal(main, "llama3.2:3b");
  assert.equal(small, "mistral:7b");
});

test("single-model relay: small falls back to main itself", () => {
  const { main, small } = pickModels(["only-model:latest"], "qwen3.8:latest", "ornith:35b");
  assert.equal(main, "only-model:latest");
  assert.equal(small, "only-model:latest");
});

test("empty model list throws, matching the Python original's RuntimeError", () => {
  assert.throws(() => pickModels([], "qwen3.8:latest", "ornith:35b"), /reported no models/);
});
