import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ollama, Message } from "ollama";
import { makeConsultSpecialist, CONSULT_MAX_TURNS } from "./consult.js";

const SMALL = "small-model";
const SPECIALIST = "specialist-model";
const POOL = [{ name: SPECIALIST, goodFor: "deep reasoning" }];
const CWD = tmpdir();
const APP_DIR = "/fake/app/dir";

function toolCallResponse(command: string) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "run_command", arguments: { command } } }],
    } as Message,
  };
}
function finalResponse(content: string) {
  return { message: { role: "assistant", content } as Message };
}
function pickResponse(name: string) {
  return finalResponse(name);
}

test("empty pool: returns immediately, client.chat is never called", async () => {
  let called = false;
  const client = { chat: async () => { called = true; return finalResponse("x"); } } as unknown as Ollama;
  const consult = makeConsultSpecialist([], SMALL, CWD, APP_DIR);
  const result = await consult(client, "do something hard");
  assert.equal(called, false);
  assert.match(result, /No specialist pool is configured\. Handle this yourself\./);
});

test("pool has entries but none fit (routing returns NONE): returns without entering the sub-loop", async () => {
  let calls = 0;
  const client = { chat: async () => { calls += 1; return finalResponse("NONE"); } } as unknown as Ollama;
  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "trivial task");
  assert.equal(calls, 1, "only the routing call, never entering the sub-loop");
  assert.match(result, /No specialist in the pool is a clearly better fit.*Handle it yourself\./);
});

test("happy path: routes to the picked specialist, runs its sub-loop, prefixes the result with which specialist answered", async () => {
  let callIndex = 0;
  const client = {
    chat: async (req: any) => {
      callIndex += 1;
      if (callIndex === 1) return pickResponse(SPECIALIST); // routing call
      assert.equal(req.model, SPECIALIST, "the sub-loop must run against the picked specialist");
      return finalResponse("here is the tricky regex");
    },
  } as unknown as Ollama;
  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "write a tricky regex");
  assert.equal(result, `Consultation with ${SPECIALIST} concluded:\nhere is the tricky regex`);
});

test("a tool_calls response runs a real command and continues the loop", async () => {
  let callIndex = 0;
  const client = {
    chat: async () => {
      callIndex += 1;
      if (callIndex === 1) return pickResponse(SPECIALIST);
      return callIndex === 2 ? toolCallResponse("echo consult-real-output") : finalResponse("done");
    },
  } as unknown as Ollama;
  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "run echo");
  assert.equal(result, `Consultation with ${SPECIALIST} concluded:\ndone`);
});

test("ANY exception mid-loop bails out IMMEDIATELY with the consult-failed message — no retry, nowhere further to escalate", async () => {
  let callIndex = 0;
  const client = {
    chat: async () => {
      callIndex += 1;
      if (callIndex === 1) return pickResponse(SPECIALIST);
      throw new Error("specialist unreachable");
    },
  } as unknown as Ollama;
  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "do a thing");
  assert.equal(callIndex, 2, "must not retry after a failure");
  assert.match(
    result,
    new RegExp(`Consult with ${SPECIALIST} failed: specialist unreachable\\. There is nowhere further to escalate this to`)
  );
});

test("a repeated identical command within the consult is NOT re-executed, and substitutes silently", async () => {
  const marker = join(tmpdir(), `eds-tui-consult-test-${Date.now()}-${Math.random()}`);
  rmSync(marker, { force: true });
  let callIndex = 0;
  const cmd = `echo hit >> ${marker} && echo cache-probe`;
  const client = {
    chat: async () => {
      callIndex += 1;
      if (callIndex === 1) return pickResponse(SPECIALIST);
      if (callIndex === 2) return toolCallResponse(cmd);
      if (callIndex === 3) return toolCallResponse(cmd); // identical repeat
      return finalResponse("wrapped up");
    },
  } as unknown as Ollama;

  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "run twice");
  assert.equal(result, `Consultation with ${SPECIALIST} concluded:\nwrapped up`);

  const hits = existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").filter(Boolean) : [];
  assert.equal(hits.length, 1, "the underlying command must only have actually executed once");
  rmSync(marker, { force: true });
});

test("exhausting CONSULT_MAX_TURNS salvages via one more no-tools call, wrapped with the step-limit note", async () => {
  let firstCall = true;
  const client = {
    chat: async (req: any) => {
      if (firstCall) {
        firstCall = false;
        return pickResponse(SPECIALIST);
      }
      return req.tools === undefined ? finalResponse("best guess from partial evidence") : toolCallResponse("echo tick");
    },
  } as unknown as Ollama;

  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "keep going forever");

  assert.match(result, new RegExp(`hit its ${CONSULT_MAX_TURNS}-step limit; this is its best`));
  assert.match(result, /best guess from partial evidence/);
});

test("exhausting CONSULT_MAX_TURNS with the salvage call ALSO failing returns the canned no-conclusion message", async () => {
  let firstCall = true;
  const client = {
    chat: async (req: any) => {
      if (firstCall) {
        firstCall = false;
        return pickResponse(SPECIALIST);
      }
      if (req.tools === undefined) throw new Error("salvage call failed too");
      return toolCallResponse("echo tick");
    },
  } as unknown as Ollama;

  const consult = makeConsultSpecialist(POOL, SMALL, CWD, APP_DIR);
  const result = await consult(client, "keep going forever");

  assert.match(result, new RegExp(`hit its ${CONSULT_MAX_TURNS}-step limit without a conclusive`));
});
