import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ollama, Message } from "ollama";
import { maybeCompact, COMPACTION_THRESHOLD_CHARS, RECENT_ROUNDS_KEPT } from "./compaction.js";

const SMALL = "small-model";

function round(i: number, size: number): Message[] {
  return [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "run_command", arguments: { command: `step-${i}` } } }],
    } as Message,
    { role: "tool", content: `${"x".repeat(size)} marker-${i}` } as Message,
  ];
}

function bigFixture(rounds: number, size: number): Message[] {
  const messages: Message[] = [
    { role: "system", content: "SYS PROMPT" },
    { role: "user", content: "THE REQUEST" },
  ];
  for (let i = 1; i <= rounds; i++) messages.push(...round(i, size));
  return messages;
}

function summarizingClient(summary: string): Ollama {
  return { chat: async () => ({ message: { role: "assistant", content: summary } as Message }) } as unknown as Ollama;
}

test("under threshold: no-op, messages left completely untouched", async () => {
  const messages = bigFixture(2, 100);
  const before = JSON.stringify(messages);
  const compacted = await maybeCompact(summarizingClient("summary"), SMALL, messages);
  assert.equal(compacted, false);
  assert.equal(JSON.stringify(messages), before);
});

test("over threshold: compacts the middle, keeps system/current-request/last rounds verbatim", async () => {
  const messages = bigFixture(10, 7000); // 10 rounds * ~7000 chars comfortably clears the 60k threshold
  assert.ok(
    messages.reduce((n, m) => n + (m.content ?? "").length, 0) > COMPACTION_THRESHOLD_CHARS,
    "fixture must actually exceed the threshold"
  );

  let calls = 0;
  const client = {
    chat: async () => {
      calls += 1;
      return { message: { role: "assistant", content: "condensed summary of the middle" } as Message };
    },
  } as unknown as Ollama;

  const compacted = await maybeCompact(client, SMALL, messages);
  assert.equal(compacted, true);
  assert.equal(calls, 1);

  assert.equal(messages[0]?.content, "SYS PROMPT");
  assert.equal(messages[1]?.content, "THE REQUEST");

  const note = messages[2];
  assert.equal(note?.role, "system", "the injected note must not be role:user — see compaction.ts's comment on why");
  assert.match(note?.content ?? "", /^SYSTEM NOTE: the following summarizes 14 earlier message\(s\)/);
  assert.match(note?.content ?? "", /condensed summary of the middle/);

  // last RECENT_ROUNDS_KEPT (3) rounds survive verbatim, in order, after the note.
  assert.equal(messages.length, 3 + RECENT_ROUNDS_KEPT * 2);
  for (let i = 0; i < RECENT_ROUNDS_KEPT; i++) {
    const roundNum = 10 - RECENT_ROUNDS_KEPT + 1 + i; // rounds 8, 9, 10
    const assistantMsg = messages[3 + i * 2];
    const toolMsg = messages[3 + i * 2 + 1];
    assert.equal(assistantMsg?.tool_calls?.[0]?.function.arguments.command, `step-${roundNum}`);
    assert.match(toolMsg?.content ?? "", new RegExp(`marker-${roundNum}$`));
  }
});

test("summarization call throwing leaves messages completely untouched", async () => {
  const messages = bigFixture(10, 7000);
  const before = JSON.stringify(messages);
  const client = { chat: async () => { throw new Error("small model unreachable"); } } as unknown as Ollama;
  const compacted = await maybeCompact(client, SMALL, messages);
  assert.equal(compacted, false);
  assert.equal(JSON.stringify(messages), before);
});

test("an empty summary reply also leaves messages untouched rather than injecting a blank note", async () => {
  const messages = bigFixture(10, 7000);
  const before = JSON.stringify(messages);
  const compacted = await maybeCompact(summarizingClient("   "), SMALL, messages);
  assert.equal(compacted, false);
  assert.equal(JSON.stringify(messages), before);
});

test("too few compactable messages (short session, over threshold via one huge message): skipped, not compacted", async () => {
  const messages: Message[] = [
    { role: "system", content: "SYS" },
    { role: "user", content: "x".repeat(COMPACTION_THRESHOLD_CHARS + 1) },
    ...round(1, 10),
  ];
  const before = JSON.stringify(messages);
  const compacted = await maybeCompact(summarizingClient("summary"), SMALL, messages);
  assert.equal(compacted, false, "fewer than MIN_COMPACTABLE_MESSAGES between the request and the tail — nothing to do");
  assert.equal(JSON.stringify(messages), before);
});

test("regression: after compaction, a reverse-scan for the most recent role:user message still finds the real request, not the synthetic note", async () => {
  const messages = bigFixture(10, 7000);
  await maybeCompact(summarizingClient("condensed"), SMALL, messages);
  const mostRecentUser = [...messages].reverse().find((m) => m.role === "user");
  assert.equal(mostRecentUser?.content, "THE REQUEST");
});
