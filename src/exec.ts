// Ported from eds_tui/main.py's run_command()/run_command_once().
//
// Timeout/kill semantics: the Python original uses plain
// `subprocess.run(..., timeout=30)` with no `start_new_session`/
// `preexec_fn`, so it has the same "may leave orphaned grandchildren"
// limitation Node's plain `child_process.exec` has — using exec here as-is
// is faithful parity, not a regression to fix. On a timeout, the Python
// original's `except subprocess.TimeoutExpired` does NOT read
// `e.stdout`/`e.stderr` — it discards whatever partial output there was and
// returns the fixed message below. This port matches that exactly: no
// partial-output capture on timeout, by design, not by omission.
//
// Also: Python's subprocess.run never checks the exit code (no
// `check=True`), so a command that merely exits non-zero (grep finding
// nothing, `ls` on a missing path, ...) is NOT an "Error:" case — only a
// genuine timeout or a catastrophic failure-to-execute is. Node's `exec`
// callback sets a non-null `error` for BOTH of those AND a plain non-zero
// exit, so this only special-cases the two that Python does.

import { exec as execCallback } from "node:child_process";
import { clipOutput } from "./clip.js";

export const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function indentLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

// Plain stdout for now — Phase 7's ui.ts will replace these with styled
// (chalk) equivalents; kept as free functions here so that swap is a
// one-file change, not a rewrite of the calling logic below.
function printCommandLabel(command: string, indent: string): void {
  console.log(`${indent}$ ${command}`);
}
function printOutput(output: string, indent: string): void {
  console.log(indentLines(output, indent));
  console.log();
}
function printError(message: string, indent: string): void {
  console.log(`${indent}Error: ${message}`);
  console.log();
}
function printCachedNote(command: string): void {
  console.log(`  $ ${command}`);
  console.log("  (already run this session — reusing the output)");
  console.log();
}

export function runCommand(
  command: string,
  cwd: string,
  indent = "  ",
  timeoutMs: number = COMMAND_TIMEOUT_MS
): Promise<string> {
  printCommandLabel(command, indent);

  return new Promise((resolve) => {
    execCallback(
      command,
      { cwd, timeout: timeoutMs, encoding: "utf8", maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null;
        const timedOut = Boolean(err && err.killed && err.signal);
        if (timedOut) {
          printError("command timed out after 30 seconds", indent);
          resolve("Error: command timed out after 30 seconds");
          return;
        }

        if (stdout === undefined && stderr === undefined) {
          // A catastrophic failure to even execute (maxBuffer exceeded, the
          // shell itself failing to spawn, ...) — mirrors Python's generic
          // `except Exception as e: return f"Error: {e}"` fallback.
          const message = err ? err.message : "unknown error";
          printError(message, indent);
          resolve(`Error: ${message}`);
          return;
        }

        // A mere non-zero exit is NOT an error here — Python's subprocess.run
        // never checks the exit code either, so `error` being set for that
        // reason alone is ignored, same as the Python original.
        let output = (stdout ?? "") + (stderr ?? "");
        output = clipOutput(output.trim()) || "(no output)";
        printOutput(output, indent);
        resolve(output);
      }
    );
  });
}

/**
 * Run a command, or replay it if this exact command already ran in this loop.
 *
 * A model that has not found what it is looking for tends to re-run
 * near-identical searches, and each repeat costs a round out of a hard
 * budget. Replaying the earlier output costs nothing and tells the model,
 * in the result it is about to read, that the repeat gave it nothing new.
 */
export async function runCommandOnce(
  command: string,
  cwd: string,
  seen: Map<string, string>,
  timeoutMs: number = COMMAND_TIMEOUT_MS
): Promise<string> {
  const trimmed = (command ?? "").trim();

  if (seen.has(trimmed)) {
    printCachedNote(trimmed);
    return (
      "This exact command already ran earlier in this session and returned:\n" +
      `${seen.get(trimmed)}\n\n` +
      "It was not run again. Re-running it cannot tell you anything new — try a " +
      "materially different command, or answer from what you already have."
    );
  }

  const output = await runCommand(trimmed, cwd, "  ", timeoutMs);
  seen.set(trimmed, output);
  return output;
}
