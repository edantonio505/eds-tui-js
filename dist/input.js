// Ported from eds_tui/main.py's interactive prompt: a PromptSession with a
// custom KeyBindings handler on Keys.BracketedPaste, plus prompt_toolkit's
// own default line-editing (arrow keys, backspace, Ctrl-C/Ctrl-D) that the
// Python original gets "for free" and this port has to hand-roll.
//
// Node's `readline` cannot be layered on top for this: its keypress parser
// consumes bracketed-paste markers (\x1b[200~ / \x1b[201~) as part of its
// own stream parsing, and by the time a byte is tokenized as a keypress,
// "this came from a paste" provenance is already lost. Bracketed-paste
// detection has to happen on the raw byte stream BEFORE any keypress
// decoding — so this owns process.stdin directly in raw mode with its own
// small CSI/ANSI state machine, deliberately narrower in scope than a
// general terminal emulator or full readline parity: only what the Python
// original's actual configured keybindings cover (arrow-key cursor
// movement, Home/End/Delete, backspace, Ctrl-C, Ctrl-D-on-empty-buffer).
//
// Known, accepted scope limits (documented rather than silently hoped past):
//   - Cursor/backspace math treats the buffer as a plain JS string (UTF-16
//     code units), not Unicode-code-point- or terminal-column-aware. A
//     surrogate-pair character (most emoji) can misbehave by one unit.
//     Solving this properly needs wcwidth-style terminal-width calculation,
//     which is exactly the complexity a general terminal emulator has and
//     this deliberately doesn't take on.
//   - No special handling for the prompt+buffer wrapping past the terminal
//     width.
//
// The pure paste-classification/splice-back logic below IS unit-tested
// (input.test.ts) since it doesn't touch stdin at all. The raw byte-stream
// event loop itself needs a real TTY to exercise meaningfully and is
// verified manually instead (paste a multi-line block, confirm the
// [+N lines] collapse and correct splice-back; Ctrl-C mid-paste; confirm
// the shell isn't left in a broken raw/bracketed-paste state afterward).
import { StringDecoder } from "node:string_decoder";
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
/**
 * Decide how a bracketed-paste's raw text should land in the input buffer.
 * Ported from main.py's handle_paste(): more than one non-blank line
 * collapses to a placeholder (and the full raw text — not trimmed — is
 * stashed for splice-back at submit time); one or zero non-blank lines are
 * inserted directly, trimmed, as if typed normally.
 */
export function classifyPaste(rawPastedText) {
    const lines = rawPastedText.split(/\r\n|\r|\n/);
    const nonBlank = lines.filter((l) => l.trim().length > 0);
    if (nonBlank.length > 1) {
        return { placeholder: true, lineCount: nonBlank.length, insertText: `[+${nonBlank.length} lines]` };
    }
    return { placeholder: false, lineCount: nonBlank.length, insertText: rawPastedText.trim() };
}
/**
 * At submit time, splice each `[+N lines]` placeholder in the final visible
 * line back to its stashed full paste text, in the order they appear, then
 * trim — ported from main.py's `re.sub(r"\[\+\d+ lines\]", ..., raw).strip()`.
 * Placeholders and stashed blocks are matched positionally (Nth placeholder
 * ↔ Nth stashed block), exactly like Python's `iter()`-based substitution.
 */
export function spliceBackPastes(finalLine, pastedBlocks) {
    let i = 0;
    const spliced = finalLine.replace(/\[\+\d+ lines\]/g, () => {
        if (i >= pastedBlocks.length)
            return ""; // more placeholders than stashed blocks shouldn't happen; degrade quietly
        return pastedBlocks[i++];
    });
    return spliced.trim();
}
/**
 * Read one line interactively from the real terminal, with bracketed-paste
 * collapse/splice-back. Requires stdin to be a TTY — callers should check
 * `process.stdin.isTTY` first (matching how the Python original only makes
 * sense run interactively; a piped/non-interactive stdin has no analogous
 * behavior to fall back to here, unlike install.sh's `/dev/tty`-bypassable
 * prompts — this is a fundamentally interactive-only feature).
 */
export function promptLine(promptText) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const decoder = new StringDecoder("utf8");
        let buf = "";
        let cursor = 0;
        const pastedBlocks = [];
        let inPaste = false;
        let pasteAccum = "";
        let pending = ""; // a possibly-incomplete escape sequence held over to the next chunk
        let done = false;
        function render() {
            process.stdout.write("\r\x1b[2K" + promptText + buf);
            const moveLeft = buf.length - cursor;
            if (moveLeft > 0)
                process.stdout.write(`\x1b[${moveLeft}D`);
        }
        function insert(text) {
            buf = buf.slice(0, cursor) + text + buf.slice(cursor);
            cursor += text.length;
        }
        function finishPaste() {
            const result = classifyPaste(pasteAccum);
            if (result.placeholder)
                pastedBlocks.push(pasteAccum);
            insert(result.insertText);
            pasteAccum = "";
            inPaste = false;
            render();
        }
        function cleanup() {
            if (done)
                return;
            done = true;
            process.stdout.write("\x1b[?2004l");
            if (stdin.isTTY)
                stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
        }
        function submit() {
            cleanup();
            process.stdout.write("\n");
            resolve({ text: spliceBackPastes(buf, pastedBlocks), cancelled: false, eof: false });
        }
        function cancel() {
            cleanup();
            process.stdout.write("\n");
            resolve({ text: "", cancelled: true, eof: false });
        }
        function eof() {
            cleanup();
            process.stdout.write("\n");
            resolve({ text: "", cancelled: false, eof: true });
        }
        function onData(chunk) {
            const str = pending + decoder.write(chunk);
            pending = "";
            let i = 0;
            while (i < str.length) {
                const rest = str.slice(i);
                if (inPaste) {
                    const endIdx = rest.indexOf(PASTE_END);
                    if (endIdx === -1) {
                        pasteAccum += rest;
                        return;
                    }
                    pasteAccum += rest.slice(0, endIdx);
                    finishPaste();
                    i += endIdx + PASTE_END.length;
                    continue;
                }
                if (rest.startsWith(PASTE_START)) {
                    inPaste = true;
                    i += PASTE_START.length;
                    continue;
                }
                // A prefix of the paste-start marker at the end of this chunk — hold
                // it over rather than risk splitting a real paste marker across reads.
                if (PASTE_START.startsWith(rest) && rest.length > 0 && rest[0] === "\x1b") {
                    pending = rest;
                    return;
                }
                const ch = rest[0];
                if (ch === "\x03")
                    return cancel();
                if (ch === "\x04") {
                    if (buf.length === 0)
                        return eof();
                    i += 1;
                    continue;
                }
                if (ch === "\r" || ch === "\n")
                    return submit();
                if (ch === "\x7f" || ch === "\x08") {
                    if (cursor > 0) {
                        buf = buf.slice(0, cursor - 1) + buf.slice(cursor);
                        cursor -= 1;
                        render();
                    }
                    i += 1;
                    continue;
                }
                if (ch === "\x1b") {
                    if (rest.length < 3) {
                        pending = rest;
                        return;
                    }
                    if (rest.startsWith("\x1b[C")) {
                        if (cursor < buf.length)
                            cursor += 1;
                        render();
                        i += 3;
                        continue;
                    }
                    if (rest.startsWith("\x1b[D")) {
                        if (cursor > 0)
                            cursor -= 1;
                        render();
                        i += 3;
                        continue;
                    }
                    if (rest.startsWith("\x1b[H") || rest.startsWith("\x1bOH")) {
                        cursor = 0;
                        render();
                        i += 3;
                        continue;
                    }
                    if (rest.startsWith("\x1b[F") || rest.startsWith("\x1bOF")) {
                        cursor = buf.length;
                        render();
                        i += 3;
                        continue;
                    }
                    if (rest.startsWith("\x1b[1~")) {
                        cursor = 0;
                        render();
                        i += 4;
                        continue;
                    }
                    if (rest.startsWith("\x1b[4~")) {
                        cursor = buf.length;
                        render();
                        i += 4;
                        continue;
                    }
                    if (rest.startsWith("\x1b[3~")) {
                        if (cursor < buf.length)
                            buf = buf.slice(0, cursor) + buf.slice(cursor + 1);
                        render();
                        i += 4;
                        continue;
                    }
                    // Unrecognized escape sequence — swallow just the ESC byte, not the
                    // whole rest of the chunk, and keep scanning.
                    i += 1;
                    continue;
                }
                insert(ch);
                render();
                i += 1;
            }
        }
        process.stdout.write("\x1b[?2004h");
        process.stdout.write(promptText);
        if (stdin.isTTY)
            stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
        // Bracketed paste and raw mode MUST be torn down on every exit path, not
        // just the happy one — a crash mid-paste would otherwise leave the
        // user's real shell silently misinterpreting paste markers after this
        // process dies. Mirrors the exact fix just made in a separate bash
        // installer this session for the identical class of bug.
        process.once("exit", cleanup);
    });
}
//# sourceMappingURL=input.js.map