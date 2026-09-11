// Ported from eds_tui/main.py's make_client()/_resolve_via_miniclosedai().
// Tries a local/LAN miniclosedai instance first — if it's reachable and
// connected to the interdata relay, uses that, preferring the desired
// main/small model names if interdata actually has them. On ANY failure
// (unreachable, not connected, empty model list, bad JSON, timeout, ...)
// falls back silently and without added latency to EDS_TUI_URL/EDS_TUI_TOKEN.
//
// Deliberately takes desiredMain/desiredSmall/env as parameters rather than
// reading EDS_TUI_MODEL/EDS_TUI_SMALL_MODEL itself — cli.ts (the real entry
// point) owns reading env vars once; this module stays testable without
// mutating process.env.

import { Ollama } from "ollama";
import { Agent, fetch as undiciFetch } from "undici";

export const DEFAULT_MAIN_MODEL = "qwen3.8:latest";
export const DEFAULT_SMALL_MODEL = "ornith:35b";
export const DEFAULT_MINICLOSEDAI_URL = "https://127.0.0.1:8095";
export const DEFAULT_HOST = "http://192.168.0.110:11434";

export interface ResolvedClient {
  client: Ollama;
  mainModel: string;
  smallModel: string;
}

// miniclosedai's dev.sh serves its own API over self-signed TLS by default
// (https://<host>:8095) — same trust model already used elsewhere for
// same-box/LAN sibling services in that project (e.g. its voicestudio proxy
// disables verification for the same reason). Only ever used for a same-box/
// LAN relay call, never for the actual interdata credential.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const insecureFetch = ((input: any, init?: any) =>
  undiciFetch(input, { ...init, dispatcher: insecureAgent })) as typeof fetch;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

/**
 * Which main/small model names to actually use, given what a relay reports
 * as available. Prefers the desired names when the relay actually has them;
 * otherwise falls back to whatever it does have. Pulled out as a pure
 * function so this precedence is unit-testable without a live server.
 */
export function pickModels(
  names: string[],
  desiredMain: string,
  desiredSmall: string
): { main: string; small: string } {
  if (names.length === 0) {
    throw new Error("miniclosedai relay reported no models");
  }
  const main = names.includes(desiredMain) ? desiredMain : names[0]!;
  const remaining = names.filter((n) => n !== main);
  const small = names.includes(desiredSmall) ? desiredSmall : remaining[0] ?? main;
  return { main, small };
}

async function resolveViaMiniclosedai(
  desiredMain: string,
  desiredSmall: string,
  env: NodeJS.ProcessEnv
): Promise<ResolvedClient> {
  const base = stripTrailingSlashes(env.EDS_TUI_MINICLOSEDAI_URL ?? DEFAULT_MINICLOSEDAI_URL);
  const mcToken = env.EDS_TUI_MINICLOSEDAI_TOKEN ?? "";
  const headers: Record<string, string> = mcToken ? { Authorization: `Bearer ${mcToken}` } : {};

  const res = await insecureFetch(`${base}/relay/api/tags`, {
    headers,
    signal: AbortSignal.timeout(2000),
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`miniclosedai relay probe failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as OllamaTagsResponse;
  const names = (data.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n));

  const { main, small } = pickModels(names, desiredMain, desiredSmall);

  // No `timeout` field exists on ollama-js's Config (confirmed by reading
  // its source) — it applies no default request timeout unless the caller
  // passes an AbortSignal itself, which already matches Python's explicit
  // `timeout=None` (wait indefinitely for a long generation). Nothing to
  // configure here for parity.
  const client = new Ollama({ host: `${base}/relay/`, headers, fetch: insecureFetch });
  return { client, mainModel: main, smallModel: small };
}

function fallbackClient(
  desiredMain: string,
  desiredSmall: string,
  env: NodeJS.ProcessEnv
): ResolvedClient {
  const host = stripTrailingSlashes(env.EDS_TUI_URL ?? DEFAULT_HOST);
  const token = env.EDS_TUI_TOKEN ?? "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const client = new Ollama({ host, headers });
  return { client, mainModel: desiredMain, smallModel: desiredSmall };
}

export async function makeClient(
  desiredMain: string = DEFAULT_MAIN_MODEL,
  desiredSmall: string = DEFAULT_SMALL_MODEL,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedClient> {
  try {
    return await resolveViaMiniclosedai(desiredMain, desiredSmall, env);
  } catch {
    // miniclosedai not reachable, or not connected to interdata — fall back,
    // silently, matching the Python original's bare `except Exception: pass`.
    return fallbackClient(desiredMain, desiredSmall, env);
  }
}
