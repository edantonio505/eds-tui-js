// Tier-3 model routing: mainly use the two configured main/small models
// (unchanged), but when the main model genuinely exhausts its turn budget
// without concluding, escalate once more to whichever specialist model in
// a user-curated pool best fits the ORIGINAL request, instead of just
// salvaging an answer from the same model that already struggled.
//
// The pool lives in ~/.eds_tui/models.json, same philosophy as the skills
// system (~/.eds_tui/skills/): a small, user-curated, git-independent file
// that survives eds-tui upgrades. The live interdata network can carry
// 20-40+ models, many near-duplicate variants of the same base model at
// different sizes/hosting — a model can't reliably pick a good fit from
// that raw, undifferentiated list; it needs to know what each pool entry is
// actually good AT, the same reason skills carry a one-line description
// rather than expecting the model to infer intent from a bare name.
//
// Nothing in here may throw on a missing/malformed pool file — same
// never-throws discipline as skills.ts: a node with no pool configured
// (the common case, at least initially) just never has a tier-3 to
// escalate to, not a crash.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const MODEL_POOL_FILE = join(homedir(), ".eds_tui", "models.json");
/** Load the specialist-model pool. Missing file, unreadable file, or malformed JSON all degrade to an empty pool, never a throw. */
export function loadPool(path = MODEL_POOL_FILE) {
    if (!existsSync(path))
        return [];
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const entries = [];
    for (const raw of parsed) {
        if (raw &&
            typeof raw === "object" &&
            typeof raw.name === "string" &&
            raw.name.trim() &&
            typeof raw.good_for === "string" &&
            raw.good_for.trim()) {
            entries.push({ name: raw.name.trim(), goodFor: raw.good_for.trim() });
        }
    }
    return entries;
}
function poolIndexLines(pool) {
    return pool.map((p) => `- ${p.name}: ${p.goodFor}`).join("\n");
}
const MODEL_POOL_MATCH_SYSTEM = (index) => "You pick the best specialist model for a request a general-purpose assistant " +
    "could not adequately handle on its own.\n" +
    "Reply with exactly one word: the name of the model below best suited to this " +
    "specific request, or NONE if none of them are a clearly better fit than a " +
    "general-purpose model.\n" +
    `Models:\n${index}\n` +
    "Output only that one word.";
/**
 * Which pool entry (if any) best fits this request. Uses the small model to
 * make the pick — the same cheap/fast routing role it already plays for
 * classifyComplexity()/matchSkill() — never the model that just struggled.
 * Never throws: a routing-pick failure should not block salvaging an
 * answer some other way.
 */
export async function pickSpecialistModel(client, userInput, pool, smallModel) {
    if (pool.length === 0)
        return null;
    let reply;
    try {
        const response = await client.chat({
            model: smallModel,
            messages: [
                { role: "system", content: MODEL_POOL_MATCH_SYSTEM(poolIndexLines(pool)) },
                { role: "user", content: userInput },
            ],
            think: false,
            options: { temperature: 0, num_predict: 16 },
        });
        reply = (response.message.content ?? "").toLowerCase();
    }
    catch {
        return null;
    }
    // Only a real pool name matches, so a hallucinated/garbled reply reads as
    // no match — same defensive pattern as skills.match(). Longest name
    // first so one model's name can't be a substring-prefix of another's.
    const sorted = [...pool].sort((a, b) => b.name.length - a.name.length);
    for (const entry of sorted) {
        if (reply.includes(entry.name.toLowerCase()))
            return entry.name;
    }
    return null;
}
//# sourceMappingURL=model-pool.js.map