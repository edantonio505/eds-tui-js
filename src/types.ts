// Shared types across modules. The Python original passed loosely-typed
// dicts for a Skill and a run's observability stats; both get a real
// interface here since TS has no equivalent of "just trust the dict shape."

export type ModelRole = "main" | "small" | "any";

export interface Skill {
  name: string;
  description: string;
  model: ModelRole;
  body: string;
  dir: string;
}

// Populated by agentic_loop() (agent.ts) for observability; consumed by the
// --test self-check suite (selftest.ts). Mirrors main.py's `stats` dict.
export interface RunStats {
  turns: number;
  delegations: number;
  commands: number;
  skillsLoaded: number;
  skillsCreated: number;
  escalated: boolean;
  capped: boolean;
  model: string;
}
