// marked-terminal@7's new function-based extension API (markedTerminal(),
// for use with marked.use()) has no published types — @types/marked-terminal
// only covers the old class-based TerminalRenderer API from the marked
// v4/v5 era and would misrepresent this shape. Minimal ambient declaration
// covering only what ui.ts actually calls.
declare module "marked-terminal" {
  export function markedTerminal(options?: Record<string, unknown>, highlightOptions?: Record<string, unknown>): unknown;
}
