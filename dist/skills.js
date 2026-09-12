// Ported near-verbatim from eds_tui/skills.py.
//
// A skill is a directory under ~/.eds_tui/skills holding a SKILL.md: a flat
// 'key: value' frontmatter block between --- fences, then a Markdown body.
// The description is all the model sees until the skill is actually loaded;
// the body is the procedure it follows once it is.
//
// Nothing in here may throw on a missing/malformed skill. A missing
// directory, an unreadable file or a malformed SKILL.md degrades to a
// smaller registry, never an uncaught exception — ask has to keep working
// for a user with no skills, or with one half-written one. write() is the
// one function that DOES throw, deliberately — its errors are meant to be
// caught by the caller and handed back to the model as a tool result.
//
// Skills are read from the user's home directory only, never from the
// working directory. A skill is instructions that an agent with unconfirmed
// shell access will follow, so picking them up from whatever repo happens
// to be cd'd into would be a prompt-injection path straight into
// run_command.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SKILLS } from "./default-skills.js";
export let SKILLS_DIR = join(homedir(), ".eds_tui", "skills");
export const VALID_MODELS = ["main", "small", "any"];
// A skill name becomes a directory name, and may arrive from a language
// model, so it is validated before it is ever joined onto a path —
// '../../.bashrc' must never be a write target.
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const TEMPLATE = (name) => `---\n` +
    `name: ${name}\n` +
    `description: One line saying when ask should reach for this. This is all the model sees until the skill loads, so make it specific.\n` +
    `model: any\n` +
    `---\n\n` +
    `Write the procedure here, as if briefing someone who has your shell but none of\n` +
    `your context.\n\n` +
    `1. First step.\n` +
    `2. Second step.\n`;
let cache = null;
let problemsList = [];
/** Split flat 'key: value' frontmatter from the body. Nested YAML is not supported. */
export function parseFrontmatter(text) {
    const lines = text.split("\n");
    if (lines.length === 0 || lines[0].trim() !== "---") {
        return { meta: {}, body: text };
    }
    const meta = {};
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "---") {
            return { meta, body: lines.slice(i + 1).join("\n").trim() };
        }
        const sepIndex = line.indexOf(":");
        if (sepIndex !== -1) {
            const key = line.slice(0, sepIndex).trim().toLowerCase();
            const value = line.slice(sepIndex + 1).trim();
            meta[key] = value;
        }
    }
    return { meta: {}, body: text }; // unterminated fence: no usable frontmatter
}
function loadOne(directory) {
    const text = readFileSync(join(directory, "SKILL.md"), "utf8");
    const { meta, body } = parseFrontmatter(text);
    const description = meta.description ?? "";
    if (!description) {
        throw new Error("no 'description' in the frontmatter");
    }
    if (!body.trim()) {
        throw new Error("nothing below the frontmatter");
    }
    const model = (meta.model ?? "any").toLowerCase();
    if (!VALID_MODELS.includes(model)) {
        throw new Error(`model must be one of ${VALID_MODELS.join(", ")}, got '${model}'`);
    }
    const name = meta.name || directory.split("/").pop();
    return { name, description, model, body, dir: directory };
}
/** Every well-formed skill, keyed by name. Cached — ask is a one-shot process. */
export function discover() {
    if (cache !== null)
        return cache;
    cache = new Map();
    problemsList = [];
    let entries;
    try {
        entries = readdirSync(SKILLS_DIR).sort();
    }
    catch {
        return cache; // no skills directory at all is the normal case, not an error
    }
    for (const entry of entries) {
        const directory = join(SKILLS_DIR, entry);
        const skillFile = join(directory, "SKILL.md");
        try {
            if (!statSync(skillFile).isFile())
                continue;
        }
        catch {
            continue;
        }
        try {
            const skill = loadOne(directory);
            cache.set(skill.name, skill);
        }
        catch (e) {
            problemsList.push([entry, e instanceof Error ? e.message : String(e)]);
        }
    }
    return cache;
}
/** [directory, reason] for every SKILL.md that failed to parse. Surfaced by --skills. */
export function problems() {
    discover();
    return [...problemsList];
}
/** Look up a skill by name, case-insensitively. null if there is no such skill. */
export function get(name) {
    const found = discover();
    if (name && found.has(name))
        return found.get(name);
    const lowered = (name ?? "").toLowerCase();
    for (const [key, skill] of found) {
        if (key.toLowerCase() === lowered)
            return skill;
    }
    return null;
}
/** The name+description index — everything the model knows until a skill loads. */
export function indexLines(subset) {
    const entries = subset
        ? subset instanceof Map
            ? [...subset.values()]
            : Object.values(subset)
        : [...discover().values()];
    return entries.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
/**
 * The first known skill name appearing in text. Used to read a skill out of
 * the triage model's reply, which is often loosely formatted. Longest name
 * first so 'deploy' cannot shadow 'deploy-flow'.
 */
export function match(text, subset) {
    const found = subset ? (subset instanceof Map ? subset : new Map(Object.entries(subset))) : discover();
    const lowered = (text ?? "").toLowerCase();
    const names = [...found.keys()].sort((a, b) => b.length - a.length);
    for (const name of names) {
        if (lowered.includes(name.toLowerCase()))
            return found.get(name);
    }
    return null;
}
/** A skill as the model receives it, with its directory named so bundled files resolve. */
export function render(skill) {
    return (`--- skill: ${skill.name} ---\n` +
        `${skill.description}\n` +
        `Files bundled with this skill live in ${skill.dir} — reference them by full path.\n\n` +
        `${skill.body}\n` +
        `--- end skill: ${skill.name} ---`);
}
/**
 * Create or replace a skill on disk, then re-read it to prove it registers.
 *
 * Every argument can come from a model, so all of them are validated here
 * rather than trusted. Throws with a message written to be handed straight
 * back to the model as a tool result, so it can correct itself and retry.
 */
export function write(args) {
    const name = (args.name ?? "").trim();
    if (!NAME_PATTERN.test(name)) {
        throw new Error("name must start with a letter or digit and contain only lowercase " +
            `letters, digits, dots, dashes or underscores — got '${name}'`);
    }
    // Frontmatter is one key per line, so a multi-line description would
    // truncate the skill's only searchable field and take the rest of it into
    // the void.
    const description = (args.description ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (!description) {
        throw new Error("description is required — it is the text skill matching searches");
    }
    const model = ((args.model ?? "any").trim().toLowerCase());
    if (!VALID_MODELS.includes(model)) {
        throw new Error(`model must be one of ${VALID_MODELS.join(", ")} — got '${model}'`);
    }
    const body = (args.body ?? "").trim();
    if (!body) {
        throw new Error("body is required — it is the procedure the model follows");
    }
    const directory = join(SKILLS_DIR, name);
    const path = join(directory, "SKILL.md");
    if (existsSync(path) && !args.overwrite) {
        throw new Error(`a skill named '${name}' already exists — pass overwrite to replace it`);
    }
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n` + `model: ${model}\n---\n\n${body}\n`);
    // Round-trip through the real parser: writing a file that does not
    // register is a silent failure, and the model needs to hear about it now.
    resetCache();
    const written = get(name);
    if (!written) {
        throw new Error(`wrote ${path} but it did not parse back — inspect it by hand`);
    }
    return written;
}
/**
 * Seed eds-tui's bundled default skills, but ONLY the very first time — i.e.
 * only when SKILLS_DIR does not exist at all yet, the signal for "this is a
 * genuinely fresh install on this machine." Once the directory exists,
 * nothing here is ever written again: editing or deleting a seeded skill
 * afterward is a durable choice, not something that silently reappears.
 * Never throws — a failure here (e.g. a read-only home directory) must not
 * block `ask` from running.
 */
export function seedDefaultSkills() {
    try {
        if (existsSync(SKILLS_DIR))
            return;
        for (const skill of DEFAULT_SKILLS) {
            const directory = join(SKILLS_DIR, skill.name);
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, "SKILL.md"), skill.content);
        }
        resetCache();
    }
    catch {
        // best-effort only
    }
}
/** Drop the cache. Only --test needs this, when it repoints SKILLS_DIR at a fixture. */
export function resetCache() {
    cache = null;
    problemsList = [];
}
/** Repoint SKILLS_DIR (used only by the --test fixture harness) and drop the cache. */
export function setSkillsDir(dir) {
    SKILLS_DIR = dir;
    resetCache();
}
//# sourceMappingURL=skills.js.map