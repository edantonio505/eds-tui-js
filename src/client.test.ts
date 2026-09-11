import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickModels, fallbackClient, DEFAULT_HOST } from "./client.js";
import { saveCredentials } from "./credentials.js";

function withTempCredentialsPath(fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "eds-tui-client-fallback-test-"));
  const path = join(dir, "credentials.json");
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

// ---------- fallbackClient: env vars vs. saved `ask --login` credentials ----------

test("fallbackClient: no env vars, no saved login — uses the hardcoded default host, no auth header", () => {
  withTempCredentialsPath((path) => {
    const { client } = fallbackClient("main", "small", {}, path);
    assert.equal((client as any).config.host, DEFAULT_HOST);
    assert.deepEqual((client as any).config.headers, {});
  });
});

test("fallbackClient: no env vars, a saved login exists — uses the saved credentials", () => {
  withTempCredentialsPath((path) => {
    saveCredentials({ hubUrl: "https://app.interdataresearch.ai", token: "relay_saved123" }, path);
    const { client } = fallbackClient("main", "small", {}, path);
    // ollama-js's formatHost() appends the default port when a bare
    // https:// URL has none — confirmed by actually running this, not
    // assumed; not a bug, just how the client normalizes a host.
    assert.equal((client as any).config.host, "https://app.interdataresearch.ai:443");
    assert.deepEqual((client as any).config.headers, { Authorization: "Bearer relay_saved123" });
  });
});

test("fallbackClient: EDS_TUI_URL/EDS_TUI_TOKEN env vars win over a saved login", () => {
  withTempCredentialsPath((path) => {
    saveCredentials({ hubUrl: "https://saved.example", token: "relay_saved" }, path);
    const { client } = fallbackClient(
      "main",
      "small",
      { EDS_TUI_URL: "http://env.example:11434", EDS_TUI_TOKEN: "env-token" },
      path
    );
    assert.equal((client as any).config.host, "http://env.example:11434");
    assert.deepEqual((client as any).config.headers, { Authorization: "Bearer env-token" });
  });
});

test("fallbackClient: EDS_TUI_URL set alone (no token env var) still wins over a saved login entirely — doesn't mix the saved token with the env URL", () => {
  withTempCredentialsPath((path) => {
    saveCredentials({ hubUrl: "https://saved.example", token: "relay_saved" }, path);
    const { client } = fallbackClient("main", "small", { EDS_TUI_URL: "http://env.example:11434" }, path);
    assert.equal((client as any).config.host, "http://env.example:11434");
    assert.deepEqual((client as any).config.headers, {}, "must not pair the saved token with an explicitly different env URL");
  });
});
