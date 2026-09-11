// Ported from eds_tui/main.py's pin_for()/resolve_model(). Deliberately
// takes a `triageFn` callback rather than importing triage.ts directly and
// calling a live Ollama client — the whole point of pulling this out of
// agent.ts is that the precedence logic (flag > skill's model: field >
// triage verdict) is exactly the kind of thing worth locking down with a
// unit test, and that only works if this module has no network dependency
// of its own. triage.ts (Phase 3) supplies the real triageFn at call sites.
/** The model a skill pins itself to via its 'model:' field, or null if it doesn't care. */
export function pinFor(skill, models) {
    if (!skill)
        return null;
    const byRole = {
        main: models.main,
        small: models.small,
        any: null,
    };
    return byRole[skill.model] ?? null;
}
/**
 * Decide which model owns this request and which skill applies.
 *
 * Precedence, most explicit first: a flag the user typed just now, then the
 * skill's own 'model:' field, then the triage verdict. --fast and --smart
 * skip triage entirely, so they also skip skill auto-matching — name one
 * with /skill-name to combine the two.
 */
export async function resolveModel(userInput, triageFn, models, opts = {}) {
    const skill = opts.skill ?? null;
    if (opts.forceFast)
        return { model: models.small, skill };
    if (opts.forceSmart)
        return { model: models.main, skill };
    const pinned = pinFor(skill, models);
    if (pinned)
        return { model: pinned, skill }; // an explicit skill that names its model needs no call
    const triaged = await triageFn(userInput);
    if (skill === null) {
        const matched = triaged.skill;
        const pinnedFromMatch = pinFor(matched, models);
        return { model: pinnedFromMatch ?? triaged.model, skill: matched };
    }
    return { model: triaged.model, skill };
}
//# sourceMappingURL=resolve-model.js.map