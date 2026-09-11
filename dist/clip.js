// Ported 1:1 from eds_tui/main.py's clip_output/MAX_OUTPUT_CHARS. A single
// tool result has to fit in a 32k context alongside everything else — an
// unbounded 'grep -r' into node_modules produced a few hundred KB in one
// round and the request failed outright, the whole run lost to one
// unfiltered search. Numbers are load-bearing and must not drift from the
// Python original: 8000 cap, 6000 head + 1500 tail kept.
export const MAX_OUTPUT_CHARS = 8000;
const HEAD_CHARS = 6000;
const TAIL_CHARS = 1500;
function withThousands(n) {
    return n.toLocaleString("en-US");
}
/** Keep the head and tail of a huge command output and say what was dropped. */
export function clipOutput(output) {
    if (output.length <= MAX_OUTPUT_CHARS) {
        return output;
    }
    const head = output.slice(0, HEAD_CHARS);
    const tail = output.slice(-TAIL_CHARS);
    const dropped = output.length - head.length - tail.length;
    return (`${head}\n\n` +
        `... [${withThousands(dropped)} characters cut. This command produced ${withThousands(output.length)} characters, ` +
        `far more than can be read. Narrow it before running anything like it again: add a ` +
        `filter, use --include / --exclude-dir=node_modules, or pipe through head.] ...\n\n` +
        `${tail}`);
}
//# sourceMappingURL=clip.js.map