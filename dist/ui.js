// Real terminal rendering, replacing the plain-console.log stubs used by
// exec.ts/agent.ts/subagent.ts through Phases 0-6. Maps main.py's Rich-based
// Console/Panel/Markdown/Live/Spinner/Text usage onto chalk + boxen + ora +
// marked/marked-terminal. Every spinner-guarded write goes through
// withSpinner() below — that single choke point is what keeps ora's spinner
// from racing a stray console.log the way it would if call sites managed
// spinner lifecycles themselves (ora, unlike rich.Live, does not coordinate
// with other stdout writes on its own).
import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import stringWidth from "string-width";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
marked.use(markedTerminal());
const BOX_BORDER_AND_PADDING_COLS = 6; // 1 border char + 2 padding each side, ×2 sides
/** Run fn() while a spinner shows `text`; the spinner is always stopped before fn's result is used, so callers never race it with their own output. */
export async function withSpinner(text, fn) {
    const spinner = ora({ text: chalk.dim.italic(text) }).start();
    try {
        return await fn();
    }
    finally {
        spinner.stop();
    }
}
export function printHeader(cwd) {
    const title = chalk.bold.whiteBright("eds") + chalk.bold.cyan(" tui");
    const body = `${title}\n${chalk.dim(cwd)}`;
    console.log();
    console.log(boxen(body, { borderStyle: "round", borderColor: "gray", padding: { top: 0, bottom: 0, left: 2, right: 2 } }));
    console.log();
}
export async function renderAnswer(content) {
    const rendered = (await marked.parse(content || "")).toString().trimEnd();
    // boxen just wraps pre-rendered text with border characters — unlike
    // Rich's Panel, it has no content-aware reflow of its own. A wide
    // element (a markdown table is the real case that surfaced this: its
    // column widths come from cli-table3 sizing to cell CONTENT, not the
    // terminal) can already be as wide as the terminal before boxen adds its
    // border+padding on top, and the terminal then hard-wraps the overflow,
    // breaking the box-drawing alignment. Rather than trying to make boxen
    // reflow arbitrary rendered Markdown (genuinely Rich-Panel-shaped
    // complexity boxen doesn't have), fall back to an unboxed print — still
    // clearly delimited, just not bordered — whenever the content is too
    // wide for a border to fit around cleanly.
    const terminalCols = process.stdout.columns || 80;
    const widestLine = Math.max(0, ...rendered.split("\n").map((line) => stringWidth(line)));
    if (widestLine + BOX_BORDER_AND_PADDING_COLS > terminalCols) {
        console.log(chalk.dim("─".repeat(Math.min(terminalCols, 80))));
        console.log(rendered);
        console.log(chalk.dim("─".repeat(Math.min(terminalCols, 80))));
        console.log();
        return;
    }
    console.log(boxen(rendered, { borderStyle: "round", borderColor: "cyan", padding: { top: 1, bottom: 1, left: 2, right: 2 } }));
    console.log();
}
function indentLines(text, indent) {
    return text
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n");
}
export function printCommand(command, indent = "  ") {
    console.log(`${indent}${chalk.bold.green("$")} ${chalk.bold.white(command)}`);
}
export function printCommandOutput(output, indent = "  ") {
    console.log(chalk.dim(indentLines(output, indent)));
    console.log();
}
export function printCommandError(message, indent = "  ") {
    console.log(chalk.red(`${indent}Error: ${message}`));
    console.log();
}
/** Main-loop-only: the cached-repeat note, WITH a command echo. Subagent's own cache hit deliberately prints nothing at all (see subagent.ts) — do not reuse this there. */
export function printCachedNote(command) {
    printCommand(command);
    console.log(chalk.dim.yellow("  (already run this session — reusing the output)"));
    console.log();
}
export function printRunningTools() {
    console.log(chalk.bold.gray("  Running tools"));
    console.log();
}
export function printEscalating(toModel) {
    console.log(chalk.dim.yellow(`  ↑ escalating to ${toModel}`));
    console.log();
}
export function printEscalatingOnFailure(fromModel, toModel, message) {
    console.log(chalk.dim.yellow(`  ↑ ${fromModel} failed (${message}), escalating to ${toModel}`));
    console.log();
}
export function printEscalatingToSpecialist(toModel) {
    console.log(chalk.dim.yellow(`  ↑ escalating to specialist model ${toModel}`));
    console.log();
}
export function printModelRequestFailed(model, message) {
    console.log(chalk.red(`  ${model} request failed (${message})`));
    console.log();
}
export function printBudgetSpent() {
    console.log(chalk.dim.yellow("  Tool-call budget spent — answering from what was found."));
    console.log();
}
export function printCouldNotProduceFinalAnswer(message) {
    console.log(chalk.red(`  Could not produce a final answer: ${message}`));
    console.log();
}
export function printStoppedNoAnswer() {
    console.log(chalk.red("  Stopped: too many tool-call rounds, and no answer could be salvaged."));
    console.log();
}
export function printSkillLabel(name, found) {
    const label = chalk.bold.blue("  ◆ ") + chalk.bold.blue("skill ");
    const nameStyled = found ? chalk.bold.white(name || "(unnamed)") : chalk.red(name || "(unnamed)");
    console.log(label + nameStyled);
    console.log();
}
export function printCreateSkillLabel(name) {
    console.log(chalk.bold.blue("  ◆ ") + chalk.bold.blue("create skill ") + chalk.bold.white(name || "(unnamed)"));
}
export function printCreateSkillError(message) {
    console.log(chalk.red(`     ✗ ${message}`));
    console.log();
}
export function printCreateSkillSuccess(path, name, model) {
    console.log(chalk.dim(`     → wrote ${path}`));
    console.log(chalk.dim(`     → re-parsed: registers as '${name}', model ${model}`));
    console.log();
}
/**
 * Printed once before N sub-agents are dispatched concurrently, listing the
 * full plan up front — their individual live progress lines can interleave
 * once they're actually running in parallel (genuine concurrency, not
 * staged/buffered), so this is what lets a reader tell which numbered task
 * a later interleaved block belongs to.
 */
export function printDelegatingTasksHeader(tasks) {
    console.log(chalk.bold.magenta(`  └─ delegating ${tasks.length} tasks in parallel:`));
    tasks.forEach((t, i) => console.log(chalk.dim(`       ${i + 1}. ${t}`)));
    console.log();
}
export function printSubagentLabel(model, task) {
    console.log(chalk.bold.magenta("  └─ ") + chalk.bold.magenta(model) + chalk.dim(`  ${task}`));
    console.log();
}
export function printSubagentResult(text) {
    console.log(chalk.dim.magenta(text));
    console.log();
}
export function printSubagentFailure(message) {
    console.log(chalk.red(`     delegation failed: ${message}`));
    console.log();
}
export function printConsultLabel(model, task) {
    console.log(chalk.bold.cyan("  └─ consulting ") + chalk.bold.cyan(model) + chalk.dim(`  ${task}`));
    console.log();
}
export function printConsultResult(text) {
    console.log(chalk.dim.cyan(text));
    console.log();
}
export function printConsultFailure(message) {
    console.log(chalk.red(`     consult failed: ${message}`));
    console.log();
}
export function printStatusLine(model, skillName) {
    let line = chalk.dim(`  ${model}`);
    if (skillName)
        line += chalk.dim.cyan(`  ·  skill: ${skillName}`);
    console.log(line);
    console.log();
}
/** The interactive prompt string: bold cyan cwd, then a bold bright-white ❯. */
export function buildPromptText(cwdShort) {
    return chalk.bold.cyan(` ${cwdShort}`) + chalk.bold.whiteBright(" ❯ ");
}
export function say(text) {
    console.log(text);
}
export function ok(text) {
    console.log(chalk.green(`✓ ${text}`));
}
export function warn(text) {
    console.error(chalk.red(`! ${text}`));
}
export function fail(text) {
    warn(text);
    process.exit(1);
}
//# sourceMappingURL=ui.js.map