// Ported from eds_tui/main.py's agentic_loop()/final_answer()/tools_for()/
// load_skill()/create_skill(), line-by-line against the Python source — this
// is the highest-risk module in the whole port (turn-budget/escalation
// state machine), so nothing here was re-derived from prose.
//
// Two turn-budget subtleties that are easy to get wrong and MUST be
// preserved exactly (confirmed by re-reading main.py:817-936 directly):
//   1. HARD_MAX_TURNS/SMALL_MAX_TURNS are checked against `turns` (the
//      ACTIVE model's own counter), never `total` (the whole-run counter,
//      which only feeds `stats.turns` for observability and never gates
//      anything).
//   2. Escalating because the small model ran out of its own turn budget
//      DOES reset `turns` to 1 (the newly-active main model gets a full
//      fresh budget for the very same loop iteration). Escalating because
//      the small model's own chat() call THREW does NOT reset `turns` —
//      it keeps counting from wherever it already was. These are two
//      different code paths in the Python original with different reset
//      behavior; conflating them would be a real, subtle bug.

import type { Ollama, Message, Tool } from "ollama";
import * as skills from "./skills.js";
import { runCommandOnce } from "./exec.js";
import { RUN_COMMAND_TOOL, DELEGATE_TOOL, LOAD_SKILL_TOOL, CREATE_SKILL_TOOL, SHELL_TOOLS } from "./tools.js";
import type { RunStats } from "./types.js";
import * as ui from "./ui.js";

export const SMALL_MAX_TURNS = 6; // tool-call rounds before escalating off the small model
export const HARD_MAX_TURNS = 14; // absolute ceiling, prevents a runaway loop

const WRAP_UP_NUDGE = (left: number): string =>
  `SYSTEM NOTE: you have ${left} tool-call round(s) left before you are cut off. ` +
  "Stop widening the search. Run something only if it would change your conclusion; " +
  "otherwise answer now from what you already have, and say which parts you could " +
  "not confirm.";

export const FINAL_ANSWER_NUDGE =
  "You have used the entire tool-call budget for this request. No further commands " +
  "will run. Answer now using only what the commands above already showed you. " +
  "State the best conclusion the evidence supports, and say plainly which parts you " +
  "could not confirm and what you would have checked next. Do not ask to run anything.";

/**
 * The main model can delegate, write skills and load them; the small model
 * just runs commands. create_skill is never gated on the registry — it is
 * how the first skill gets written.
 */
export function toolsFor(activeModel: string, mainModel: string): Tool[] {
  if (activeModel !== mainModel) return SHELL_TOOLS;
  const tools: Tool[] = [RUN_COMMAND_TOOL, DELEGATE_TOOL, CREATE_SKILL_TOOL];
  if (skills.discover().size > 0) tools.push(LOAD_SKILL_TOOL); // nothing installed, nothing to load
  return tools;
}

function loadSkill(name: string): string {
  const skill = skills.get(name);
  ui.printSkillLabel(name, Boolean(skill));

  if (skill) return skills.render(skill);

  const index = skills.indexLines();
  if (!index) return `There is no skill named '${name}', and no skills are installed.`;
  return `There is no skill named '${name}'. The skills that exist are:\n${index}`;
}

function asBool(value: unknown): boolean {
  if (typeof value === "string") {
    return ["true", "yes", "1"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function createSkill(args: Record<string, any>): string {
  const name = args.name ?? "";
  ui.printCreateSkillLabel(name);

  let skill;
  try {
    skill = skills.write({
      name,
      description: args.description ?? "",
      body: args.body ?? "",
      model: args.model ?? "any",
      overwrite: asBool(args.overwrite ?? false),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ui.printCreateSkillError(message);
    return `create_skill failed: ${message}`;
  }

  const path = `${skill.dir}/SKILL.md`;
  ui.printCreateSkillSuccess(path, skill.name, skill.model);

  return (
    `Saved and verified: ${path} parses back and registers as '${skill.name}' ` +
    `(model ${skill.model}). It is available from the next ask run onward.`
  );
}

export type DelegateTaskFn = (client: Ollama, task: string) => Promise<string>;
export type SaveHistoryFn = (messages: Message[]) => void;

export interface AgenticLoopDeps {
  client: Ollama;
  mainModel: string;
  smallModel: string;
  cwd: string;
  delegateTask: DelegateTaskFn;
  saveHistory: SaveHistoryFn;
  /**
   * Override the real SMALL_MAX_TURNS/HARD_MAX_TURNS constants for this run
   * only — real callers never set these; they default to the real exported
   * constants. Exists so selftest.ts can force escalation/capping quickly
   * and deterministically without waiting on a real model to naturally
   * burn 6-14 turns. The Python original achieves the same thing by
   * temporarily mutating its module globals (`globals()["SMALL_MAX_TURNS"]
   * = 1`); SMALL_MAX_TURNS/HARD_MAX_TURNS here are real `const` exports
   * (safer for normal use), so this explicit, opt-in seam is the TS
   * equivalent rather than a fragile global-mutation hack.
   */
  smallMaxTurns?: number;
  hardMaxTurns?: number;
}

/**
 * Make one last call with no tools attached, so the model must answer from
 * the evidence already on the transcript. The nudge itself is not saved to
 * history, only the answer it produces (if any).
 */
export async function finalAnswer(
  deps: AgenticLoopDeps,
  messages: Message[],
  activeModel: string
): Promise<string | null> {
  let response;
  try {
    response = await ui.withSpinner("Wrapping up...", () =>
      deps.client.chat({
        model: activeModel,
        messages: [...messages, { role: "user", content: FINAL_ANSWER_NUDGE }],
      })
    );
  } catch (e) {
    ui.printCouldNotProduceFinalAnswer(e instanceof Error ? e.message : String(e));
    deps.saveHistory(messages);
    return null;
  }

  const content = (response.message.content ?? "").trim();
  if (!content) {
    ui.printStoppedNoAnswer();
    deps.saveHistory(messages);
    return null;
  }

  messages.push(response.message);
  await ui.renderAnswer(content);
  deps.saveHistory(messages);
  return content;
}

export async function agenticLoop(
  deps: AgenticLoopDeps,
  messages: Message[],
  initialActiveModel: string,
  stats: Partial<RunStats> = {}
): Promise<string | null> {
  Object.assign(stats, {
    turns: 0,
    delegations: 0,
    commands: 0,
    skillsLoaded: 0,
    skillsCreated: 0,
    escalated: false,
    capped: false,
    model: initialActiveModel,
  });

  // Output of every command run this turn-loop, so an identical re-run can
  // be answered from here instead of spending a round to learn nothing.
  const seen = new Map<string, string>();

  const hardMaxTurns = deps.hardMaxTurns ?? HARD_MAX_TURNS;
  const smallMaxTurns = deps.smallMaxTurns ?? SMALL_MAX_TURNS;

  let activeModel = initialActiveModel;
  let turns = 0;
  let total = 0;

  for (;;) {
    turns += 1;
    total += 1;
    stats.turns = total;

    if (turns > hardMaxTurns) {
      stats.capped = true;
      ui.printBudgetSpent();
      return finalAnswer(deps, messages, activeModel);
    }

    if (activeModel === deps.smallModel && turns > smallMaxTurns) {
      ui.printEscalating(deps.mainModel);
      activeModel = deps.mainModel;
      stats.escalated = true;
      // The main model inherits the transcript, not the spent budget.
      turns = 1;
    }

    stats.model = activeModel;

    let response;
    try {
      response = await ui.withSpinner("Thinking...", () =>
        deps.client.chat({
          model: activeModel,
          messages,
          tools: toolsFor(activeModel, deps.mainModel),
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (activeModel === deps.smallModel) {
        ui.printEscalatingOnFailure(deps.smallModel, deps.mainModel, message);
        activeModel = deps.mainModel;
        stats.escalated = true;
        // Deliberately NOT reset here, unlike the turn-budget escalation
        // above — this is a different code path in the Python original
        // with different reset behavior; turns keeps counting.
        continue;
      }
      // The main model has nowhere to escalate to, but a request that fails
      // mid-run used to raise and discard a transcript full of gathered
      // evidence. Try to answer from it first; only if there is nothing to
      // answer from does the error reach the caller.
      ui.printModelRequestFailed(deps.mainModel, message);
      if (messages.some((m) => m.role === "tool")) {
        stats.capped = true;
        return finalAnswer(deps, messages, activeModel);
      }
      throw e;
    }

    const msg = response.message;
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      ui.printRunningTools();
      for (const tc of msg.tool_calls) {
        const args = tc.function.arguments ?? {};
        let output: string;
        if (tc.function.name === "delegate_task") {
          stats.delegations = (stats.delegations ?? 0) + 1;
          output = await deps.delegateTask(deps.client, args.task ?? "");
        } else if (tc.function.name === "load_skill") {
          stats.skillsLoaded = (stats.skillsLoaded ?? 0) + 1;
          output = loadSkill(args.name ?? "");
        } else if (tc.function.name === "create_skill") {
          stats.skillsCreated = (stats.skillsCreated ?? 0) + 1;
          output = createSkill(args);
        } else {
          stats.commands = (stats.commands ?? 0) + 1;
          output = await runCommandOnce(args.command ?? "", deps.cwd, seen);
        }
        messages.push({ role: "tool", content: output });
      }

      // Warn before the cap rather than at it. A model that knows it has
      // two rounds left will usually conclude; one that is cut off without
      // notice never gets the chance.
      const left = hardMaxTurns - turns;
      const lastMessage = messages[messages.length - 1];
      if (left > 0 && left <= 2 && lastMessage?.role === "tool") {
        lastMessage.content += "\n\n" + WRAP_UP_NUDGE(left);
      }
    } else {
      await ui.renderAnswer(msg.content);
      deps.saveHistory(messages);
      return msg.content;
    }
  }
}
