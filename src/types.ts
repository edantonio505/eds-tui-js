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
  /** The tier-3 specialist model escalated to this run, if any (see model-pool.ts). Not part of the original Python stats dict — new for the specialist-router feature. */
  specialistModel: string | null;
  /** Count of consult_specialist tool calls this run (see consult.ts). */
  consultations: number;
  /** Count of times maybeCompact() actually collapsed part of the transcript this run (see compaction.ts). */
  compactions: number;
}
