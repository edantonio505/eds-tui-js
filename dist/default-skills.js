// Skills bundled with eds-tui itself, seeded into a brand-new install so
// `ask` is useful for hard tasks out of the box, not just after a user
// happens to write this one themselves. Seeding is one-time-only (see
// skills.seedDefaultSkills) — once ~/.eds_tui/skills exists at all, nothing
// here is ever written again, so editing or deleting a seeded skill is a
// durable choice, not something that silently comes back.
export const DEFAULT_SKILLS = [
    {
        name: "hard-task-claude",
        content: `---
name: hard-task-claude
description: When a task is too hard to solve with direct shell work alone — complex debugging, large multi-file refactors, algorithm design, optimization, stuck loops — delegate it to the Claude Code CLI (claude -p) if it is installed.
model: main
---

# Delegating a genuinely hard task

Direct shell work, consult_specialist, and your own reasoning cover most
requests. For the rare task that is genuinely beyond that — a large
multi-file refactor, a stuck bug whose root cause is unclear, real
algorithm/architecture design, something expensive to iterate on by hand —
check whether the \`claude\` CLI (Claude Code) is installed:

\`\`\`bash
command -v claude
\`\`\`

If it is not installed, say so and fall back to consult_specialist (if
available) or your own best effort — do not fabricate output pretending you
ran it.

## If it is installed

\`claude\` has its own shell access to the current working directory and can
read, edit, and run things autonomously. Print mode (\`-p\`) is
non-interactive: it runs the task to completion and prints the result. Run
it from the project directory:

\`\`\`bash
timeout 1800 claude -p "<full, self-contained task prompt>" --dangerously-skip-permissions
\`\`\`

- \`--dangerously-skip-permissions\` lets it run commands without prompting —
  only use this because the user has already asked *you* to act
  autonomously on their own machine/project.
- \`timeout 1800\` prevents a hung session from blocking forever (30 min).
- For the hardest tasks: add \`--model opus\`.
- Optional soft cost cap: \`--max-budget-usd 5\`.
- \`--output-format json\` gives structured JSON output (result, cost,
  session_id) if you need to parse it.

## Writing the prompt

\`claude -p\` does not see this conversation — the prompt must be fully
self-contained:

1. State the goal concretely and the definition of done (e.g. "tests in
   tests/ pass").
2. Give context: relevant files, current error output, what has already
   been tried.
3. Set constraints: which files not to touch, style rules, keep changes
   minimal, etc.
4. Instruction on decisions: "Do not ask questions. Where a choice is
   needed, pick the most reasonable option consistent with the existing
   codebase and state what you chose and why."

## Answering questions / continuing

\`claude -p\` cannot pause for input. If its output ends with an unresolved
question or an incomplete step:

1. **Default: answer it yourself.** Pick the most reasonable option and
   continue in the same session:
   \`\`\`bash
   timeout 1800 claude -p --continue "<your answer + next step>" --dangerously-skip-permissions
   \`\`\`
2. **Only wait for the user** when the decision is genuinely theirs to
   make: destructive/irreversible actions, security-sensitive changes,
   cost/account decisions, or a preference you cannot reasonably infer. In
   that case, present the options succinctly and stop.

## Verification and reporting

Never trust the report blindly:
- Inspect what changed (\`git status\`, \`git diff\` if it's a repo).
- Run the project's tests or the relevant command yourself.
- Fix small remaining gaps directly; only send it back via \`--continue\` if
  a real chunk of work is left.
- Report to the user: what was done, key decisions made, and verification
  evidence.
`,
    },
];
//# sourceMappingURL=default-skills.js.map