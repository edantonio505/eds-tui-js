// Persisted login credentials for `ask --login`. Same ~/.eds_tui/ home
// directory convention as skills.ts and model-pool.ts. Exists because the
// only way to configure EDS_TUI_URL/EDS_TUI_TOKEN before this was hand-
// editing a shell rc file — fragile, easy to get wrong, and gives zero
// feedback when a token is stale (it just fails somewhere deep in a real
// conversation with a raw 401). `--login` validates the token against a
// real request before ever saving it, so a bad token is caught immediately
// with a clear message, not discovered mid-conversation later.
//
// Never throws on a missing/malformed file — same discipline as skills.ts
// and model-pool.ts: a node with no saved login just has none, not a crash.
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const CREDENTIALS_FILE = join(homedir(), ".eds_tui", "credentials.json");
export function loadCredentials(path = CREDENTIALS_FILE) {
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed &&
            typeof parsed === "object" &&
            typeof parsed.hub_url === "string" &&
            parsed.hub_url.trim() &&
            typeof parsed.token === "string" &&
            parsed.token.trim()) {
            return { hubUrl: parsed.hub_url.trim(), token: parsed.token.trim() };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function saveCredentials(creds, path = CREDENTIALS_FILE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hub_url: creds.hubUrl, token: creds.token }, null, 2));
    // Best-effort — a real secret, matching the 600 permissions
    // miniclosedai-node's own save_node_state() already uses for its saved
    // node credentials. chmod isn't meaningful on Windows; ignore failures.
    try {
        chmodSync(path, 0o600);
    }
    catch {
        /* not fatal — e.g. Windows, or a filesystem that doesn't support it */
    }
}
export function clearCredentials(path = CREDENTIALS_FILE) {
    if (!existsSync(path))
        return false;
    unlinkSync(path);
    return true;
}
//# sourceMappingURL=credentials.js.map