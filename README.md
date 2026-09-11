# eds-tui

Natural Language Command Executor — a one-shot terminal AI assistant powered
by a local (or network-routed) Ollama-compatible model.

TypeScript rewrite of [edstui](https://github.com/edantonio505/edstui)
(Python/pipx), published to npm so installing it is a plain package-manager
pull over HTTPS — no `git clone`, no Python/pipx toolchain needed on the
target machine at install time.

## Install

```bash
npm install -g eds-tui
```

Needs Node.js >=20. This gives you the `ask` command on PATH.

## Configuration

Add to your `~/.bashrc`, `~/.bash_aliases`, or `~/.zshrc`:

```bash
export EDS_TUI_URL="http://your-ollama-host:11434"
export EDS_TUI_TOKEN="your_token_here"   # optional, only if your server requires auth

export EDS_TUI_MODEL="qwen3.8:latest"    # optional, main model
export EDS_TUI_SMALL_MODEL="ornith:35b"  # optional, model for simpler requests
```

Both models must be served from the same Ollama host and support tool calling.

### Auto-connecting through miniclosedai

If a [miniclosedai](https://github.com/edantonio505/miniclosedai) instance is
reachable and it's itself connected to the interdata relay, `ask` uses that
automatically — no config needed beyond what miniclosedai's own installer
already writes to `~/.bash_aliases`. Each run of `ask`:

1. Asks miniclosedai (`GET /relay/api/tags`, ~2s timeout) which models the
   interdata relay currently has.
2. If that succeeds, runs against interdata through miniclosedai's `/relay`
   proxy — preferring `EDS_TUI_MODEL`/`EDS_TUI_SMALL_MODEL` (or their
   `qwen3.8:latest`/`ornith:35b` defaults) if interdata actually has them,
   else falling back to whatever models interdata does have.
3. If miniclosedai isn't reachable, or interdata isn't connected/enabled,
   `ask` falls straight back to `EDS_TUI_URL`/`EDS_TUI_TOKEN` above, silently
   — no error, no behavior change.

```bash
export EDS_TUI_MINICLOSEDAI_URL="https://127.0.0.1:8095"   # optional, default shown
export EDS_TUI_MINICLOSEDAI_TOKEN=""                       # optional, only if miniclosedai's API auth is enabled
```

## Usage

```bash
ask                  # start a fresh conversation (clears history)
ask --continue       # continue the previous conversation
ask --fast           # force the small model for this request
ask --smart          # force the main model for this request
ask --skills         # list installed skills
ask --skill-new NAME # scaffold a new skill
ask --test           # self-check: prove routing, skills, delegation, escalation and specialist routing work
ask --upgrade        # update to the latest version (npm install -g eds-tui@latest)
```

## Model routing

Routing has three tiers. **Mainly the first two are used** — the third only
kicks in when a task genuinely proves too hard for the main model.

1. **Triage** (every request): a short classification call to the small
   model decides whether the request is simple — a lookup, a listing, a
   status check, a one-off command — or complex enough to need the main
   model. The whole agentic loop then runs on whichever model was picked,
   printed above the answer. Use `--fast`/`--smart` to skip triage and force
   a model.
2. **Escalation** (small → main): if the small model takes a request and
   then stalls — more than 6 tool-call rounds, or a request error — the
   conversation hands off to the main model and continues from there
   (`↑ escalating to ...`). It inherits the transcript, not the small
   model's spent turn budget, so it gets a full fresh 14 rounds.
3. **Tier 3 — specialist escalation** (main → a network specialist): if the
   *main* model also exhausts its own turn budget without concluding, `ask`
   tries once more before giving up — it asks the small model to pick the
   best-fit entry from a specialist pool you configure (see below), and, if
   one clearly fits, hands the request to that model instead, with a full
   fresh budget and the same tools the main model gets. Only fires once per
   request; if the specialist also can't finish, the run salvages an answer
   from whatever it found, same as tier 1→2.

### Configuring the specialist pool

Not configured by default — tier 3 simply never fires until you set this up.
Create `~/.eds_tui/models.json`:

```json
[
  { "name": "deepseek-r1:8b", "good_for": "deep multi-step reasoning, math, logic, proofs" },
  { "name": "qwen3-coder-next", "good_for": "code generation, refactoring, debugging large codebases" },
  { "name": "llava:7b", "good_for": "describing or analyzing images" }
]
```

Each entry needs a real model name reachable on whatever host `ask` is
already talking to, and a one-line `good_for` — that's the *only* thing the
routing model sees when deciding whether an entry fits a given request, the
same reason [skills](#skills) carry a one-line description rather than
expecting a model to infer intent from a bare name. Keep this list small and
genuinely differentiated: a live interdata-style network can carry 20-40+
models, many near-duplicate variants of the same base model at different
sizes or hosting — an undifferentiated dump of all of them doesn't give the
small model anything real to route on.

A malformed or missing file degrades to "no specialist pool," never an
error — same never-throws discipline the skills registry uses.

## Turn budget

Each model gets up to 14 tool-call rounds per request (5 for a delegated
sub-agent). **Escalation resets that budget** — the newly-active model
inherits the transcript, not the rounds already spent, so a request that
escalates does not leave the next tier with fewer rounds to finish an
investigation it just walked into. (One documented exception: if a model's
own request *errors out* rather than running out of rounds, the escalation
that follows does *not* reset the counter — it keeps counting from wherever
it was. A budget-exhaustion escalation and a request-failure escalation are
different situations and get different treatment.)

Two things keep a run from ending empty-handed:

- **Repeated commands are not re-run.** If the model asks for a command it
  already ran this session, the earlier output is replayed with a note
  saying so, and the round is not spent on the shell.
- **Command output is clipped at ~8,000 characters**, head and tail kept,
  with a note telling the model to narrow the search.
- **Running out of rounds produces an answer, not an error.** At the cap,
  `ask` first tries tier-3 escalation (if configured); failing that, it
  makes one final call with the tools removed, so the model has to conclude
  from the evidence already gathered and say what it could not confirm.

## Skills

A skill is a reusable procedure you write once and `ask` loads when it is
relevant — how *you* ship a release, how *you* restore a dev database, the
three commands that actually diagnose a bad deploy on *your* machine.

They live in `~/.eds_tui/skills/`, one directory each:

```
~/.eds_tui/skills/
  deploy-flow/
    SKILL.md
```

`SKILL.md` is frontmatter plus a Markdown body:

```markdown
---
name: deploy-flow
description: Ship a release from this repo — branch checks, tag, push, verify.
model: main
---

1. Confirm the working tree is clean and we are not on `main`.
2. ...
```

- `description` is **required** — the only thing the model sees until the
  skill loads, so make it specific.
- `name` defaults to the directory name.
- `model` is `main`, `small` or `any` (default).

Frontmatter is flat `key: value` only — nested YAML is not supported.

Three ways to write one, increasing order of how much you should trust the
result: `ask --skill-new NAME` scaffolds a starter file; ask `ask` for it
("remember how to check what's using a port, make it a skill") — the main
model has a `create_skill` tool that writes the file and immediately
re-reads it through the real parser; or write the file yourself.

**Read what the model writes before trusting it.** `create_skill` guarantees
the *file* is valid, not that the *commands in it* are correct.

Skills are read from your home directory only, never the working directory
— picking them up from whatever repo you `cd` into would turn cloning a
repository into a code-execution path.

## Delegation

The main model (or a tier-3 specialist standing in for it) also gets a
`delegate_task` tool and can spawn the small model as a sub-agent for
mechanical legwork — gathering listings, counting things, checking status —
while it stays on the reasoning. A sub-agent gets shell access but no
delegation tool of its own and no view of the parent conversation, so each
delegated task has to stand alone. It runs its own agentic loop (up to 5
steps) and returns a text report as the parent's tool result.

### Parallel fan-out (`delegate_tasks`)

When it has several genuinely **independent** pieces of legwork — nothing
that depends on another task's result — the main model can hand them all to
`delegate_tasks` at once instead of calling `delegate_task` repeatedly.
They run **at the same time as each other**, not one after another: real
concurrency (`Promise.all`, not a queue), each with its own sub-agent, its
own shell, and no visibility into the others. Their combined reports come
back as one tool result, labeled by task number.

This isn't just faster because the tasks overlap — it's faster because a
network with more than one node serving the delegate model spreads
concurrent requests across them for free. miniaicloud's relay round-robins
across every backend registered for a given model name on each request; `ask`
never has to know or care which physical node ends up doing the work.
Measured live against a real multi-node network: 4 independent delegated
tasks took **2.07x longer run one at a time than run concurrently**.

## Self-check

`ask --test` exercises the whole arrangement against your live server and
reports pass/fail, exiting nonzero if anything broke — including a real
tier-3 escalation to a specialist model if `~/.eds_tui/models.json` is
configured for your network. The skill checks build a throwaway fixture in a
temp directory — they never touch your real `~/.eds_tui/skills`.

## Conversation history

By default, every run of `ask` starts a completely fresh conversation. Use
`ask --continue` to keep the context going across multiple runs — history is
saved to `~/.eds_tui_history.json` after each response, and running `ask`
without `--continue` always clears it.

## How it works

- Type your question and press Enter to submit
- Paste multi-line text — it collapses to `[+N lines]` so you can keep typing
- The model can run shell commands on your machine to answer questions
- Exits after one question and answer
