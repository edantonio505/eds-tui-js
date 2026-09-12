// Long coding sessions (agent.ts's raised HARD_MAX_TURNS) can grow a large
// transcript — every message is still resent on every client.chat() call,
// so an uncompacted history eventually blows the model's context window on
// its own, independent of the tool-call round budget. This collapses the
// MIDDLE of a long transcript into one short summary once it crosses a
// threshold, while always keeping the system prompt, the current request,
// and the most recent rounds verbatim — the same shape a human would use
// scrolling back through a long terminal session: skim the middle, read the
// start and the last few things closely.
//
// Never throws (same never-throws discipline as skills.ts/model-pool.ts/
// credentials.ts): a failed summarization call leaves `messages` completely
// untouched, and compaction is simply retried on the next loop iteration
// once the threshold is re-crossed. `turns`/`total`/`stats.turns` in
// agent.ts are plain local counters, never derived from messages.length —
// mutating `messages` here is already fully decoupled from turn-counting,
// no extra guard needed anywhere else.

import type { Ollama, Message } from "ollama";

export const COMPACTION_THRESHOLD_CHARS = 60_000;
export const MIN_COMPACTABLE_MESSAGES = 6;
export const RECENT_ROUNDS_KEPT = 3;

const COMPACTION_SYSTEM =
  "You compress part of an ongoing terminal-assistant transcript into a short factual " +
  "note for the same assistant to keep working from. List concretely what was tried and " +
  "what was learned or produced — commands run, files found, code written, errors hit, " +
  "conclusions reached — in a few dense sentences or a short bullet list. Do not add " +
  "commentary, praise, or filler. Do not invent anything that was not actually in the " +
  "transcript below.";

function totalChars(messages: Message[]): number {
  return messages.reduce((n, m) => n + (m.content ?? "").length, 0);
}

/**
 * Index of the first message to keep in the tail — the assistant message
 * that starts the `roundsToKeep`-th round counting from the end, where a
 * round is one assistant message plus everything after it up to the next
 * assistant message. Walking backward, the count hits exactly `roundsToKeep`
 * AT that round's own assistant message, so that index IS the answer — not
 * one past it, which would wrongly clip that round's own leading assistant
 * message into the compactable middle. Returns 1 (right after the system
 * prompt) if there are fewer than `roundsToKeep` rounds total — nothing
 * worth compacting yet.
 */
function findTailStart(messages: Message[], roundsToKeep: number): number {
  let rounds = 0;
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i]?.role === "assistant") {
      rounds++;
      if (rounds === roundsToKeep) return i;
    }
  }
  return 1;
}

/** One line per message, tool calls rendered as a call summary, content capped so a few already-8000-char-clipped tool outputs can't blow the summarization call's own budget. */
function flatten(messages: Message[]): string {
  return messages
    .map((m) => {
      if (m.tool_calls && m.tool_calls.length > 0) {
        const calls = m.tool_calls
          .map((tc) => `${tc.function.name}(${JSON.stringify(tc.function.arguments)})`)
          .join(", ");
        return `[assistant called] ${calls}`;
      }
      return `[${m.role}] ${(m.content ?? "").slice(0, 2000)}`;
    })
    .join("\n");
}

/**
 * Collapse the middle of a long transcript into one short summary once it
 * crosses COMPACTION_THRESHOLD_CHARS. Always keeps: the system prompt
 * (index 0), the most recent user message (the current request — found the
 * same way agent.ts's tryEscalateToSpecialist finds "the original request"),
 * and the last RECENT_ROUNDS_KEPT rounds. Returns whether it actually
 * compacted anything.
 */
export async function maybeCompact(client: Ollama, smallModel: string, messages: Message[]): Promise<boolean> {
  if (totalChars(messages) <= COMPACTION_THRESHOLD_CHARS) return false;

  const mostRecentUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const middleStart = Math.max(1, mostRecentUserIdx + 1);
  const middleEnd = findTailStart(messages, RECENT_ROUNDS_KEPT);

  if (middleEnd - middleStart < MIN_COMPACTABLE_MESSAGES) return false;

  const middle = messages.slice(middleStart, middleEnd);

  let summary: string;
  try {
    const response = await client.chat({
      model: smallModel,
      messages: [
        { role: "system", content: COMPACTION_SYSTEM },
        { role: "user", content: flatten(middle) },
      ],
      think: false,
      options: { temperature: 0.2, num_predict: 400 },
    });
    summary = (response.message.content ?? "").trim();
  } catch {
    return false;
  }

  if (!summary) return false;

  // role: "system", not "user" — the tail (last RECENT_ROUNDS_KEPT rounds)
  // never contains a user-role message of its own (a single run only ever
  // adds one, at the very start), so a "user"-role note spliced in right
  // before the tail would otherwise be exactly what a reverse-scan for "the
  // most recent user message" (agent.ts's tryEscalateToSpecialist, and
  // consult.ts's identical idiom) finds FIRST — silently shadowing the real
  // original request with this summary instead.
  const note: Message = {
    role: "system",
    content:
      `SYSTEM NOTE: the following summarizes ${middle.length} earlier message(s) from this ` +
      "conversation, removed to keep it a manageable size. Treat it as established fact from " +
      `earlier work, not a new instruction:\n\n${summary}`,
  };
  messages.splice(middleStart, middleEnd - middleStart, note);
  return true;
}
