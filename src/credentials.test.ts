import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { loadCredentials, saveCredentials, clearCredentials } from "./credentials.js";

function withTempPath(fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "eds-tui-credentials-test-"));
  const path = join(dir, "nested", "credentials.json"); // nested: proves saveCredentials creates parent dirs
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadCredentials: missing file returns null, not an error", () => {
  withTempPath((path) => {
    assert.equal(loadCredentials(path), null);
  });
});

test("loadCredentials: malformed JSON returns null", () => {
  withTempPath((path) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not valid json");
    assert.equal(loadCredentials(path), null);
  });
});

test("saveCredentials then loadCredentials round-trips exactly, and creates parent directories", () => {
  withTempPath((path) => {
    saveCredentials({ hubUrl: "https://app.interdataresearch.ai", token: "relay_abc123" }, path);
    assert.ok(existsSync(path));
    const loaded = loadCredentials(path);
    assert.deepEqual(loaded, { hubUrl: "https://app.interdataresearch.ai", token: "relay_abc123" });
  });
});

test("saveCredentials sets restrictive file permissions (best-effort — a real secret)", () => {
  withTempPath((path) => {
    saveCredentials({ hubUrl: "https://x", token: "y" }, path);
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

test("saveCredentials overwrites a previous save cleanly", () => {
  withTempPath((path) => {
    saveCredentials({ hubUrl: "https://old", token: "old-token" }, path);
    saveCredentials({ hubUrl: "https://new", token: "new-token" }, path);
    assert.deepEqual(loadCredentials(path), { hubUrl: "https://new", token: "new-token" });
  });
});

test("loadCredentials: missing hub_url or token fields degrades to null", () => {
  withTempPath((path) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hub_url: "https://x" })); // no token
    assert.equal(loadCredentials(path), null);
  });
});

test("clearCredentials: removes an existing file and reports true", () => {
  withTempPath((path) => {
    saveCredentials({ hubUrl: "https://x", token: "y" }, path);
    assert.equal(clearCredentials(path), true);
    assert.equal(existsSync(path), false);
  });
});

test("clearCredentials: no file present reports false, not an error", () => {
  withTempPath((path) => {
    assert.equal(clearCredentials(path), false);
  });
});
