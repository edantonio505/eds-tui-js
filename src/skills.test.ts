import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as skills from "./skills.js";
import { DEFAULT_SKILLS } from "./default-skills.js";

// Mirrors main.py's self-check with_fixture_skills(): --test must never
// touch the user's real ~/.eds_tui/skills, so SKILLS_DIR is repointed at a
// throwaway directory for every test and restored after.
let tmp: string;
let realDir: string;

beforeEach(() => {
  realDir = skills.SKILLS_DIR;
  tmp = mkdtempSync(join(tmpdir(), "eds-tui-skills-test-"));
  skills.setSkillsDir(tmp);
});

afterEach(() => {
  skills.setSkillsDir(realDir);
  rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(name: string, contents: string) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), contents);
}

test("parseFrontmatter: flat key:value between --- fences", () => {
  const { meta, body } = skills.parseFrontmatter(
    "---\nname: foo\ndescription: does foo\nmodel: main\n---\n\nStep 1.\nStep 2.\n"
  );
  assert.equal(meta.name, "foo");
  assert.equal(meta.description, "does foo");
  assert.equal(meta.model, "main");
  assert.equal(body, "Step 1.\nStep 2.");
});

test("parseFrontmatter: unterminated fence returns no usable frontmatter", () => {
  const { meta, body } = skills.parseFrontmatter("---\nname: foo\nno closing fence here");
  assert.deepEqual(meta, {});
  assert.equal(body, "---\nname: foo\nno closing fence here");
});

test("discover: missing skills directory degrades to an empty registry, not an error", () => {
  rmSync(tmp, { recursive: true, force: true }); // directory doesn't exist at all
  skills.resetCache();
  assert.equal(skills.discover().size, 0);
});

test("discover: a well-formed skill round-trips name/description/model/body", () => {
  writeFixture(
    "deploy-flow",
    "---\nname: deploy-flow\ndescription: Ship a release.\nmodel: main\n---\n\n1. Do it.\n"
  );
  skills.resetCache();
  const found = skills.discover();
  const skill = found.get("deploy-flow");
  assert.ok(skill);
  assert.equal(skill!.description, "Ship a release.");
  assert.equal(skill!.model, "main");
  assert.match(skill!.body, /1\. Do it\./);
});

test("discover: name defaults to the directory name when frontmatter omits it", () => {
  writeFixture("triage-logs", "---\ndescription: Triage logs.\n---\n\nBody here.\n");
  skills.resetCache();
  assert.ok(skills.discover().has("triage-logs"));
});

test("discover: missing description is skipped and reported via problems()", () => {
  writeFixture("broken-1", "---\nmodel: main\n---\n\nBody with no description field.\n");
  skills.resetCache();
  assert.equal(skills.discover().size, 0);
  const probs = skills.problems();
  assert.equal(probs.length, 1);
  assert.equal(probs[0]![0], "broken-1");
  assert.match(probs[0]![1], /description/);
});

test("discover: invalid model value is skipped and reported", () => {
  writeFixture("broken-2", "---\ndescription: x\nmodel: bogus\n---\n\nBody.\n");
  skills.resetCache();
  assert.equal(skills.discover().size, 0);
  const probs = skills.problems();
  assert.match(probs[0]![1], /model must be one of/);
});

test("discover: a good skill alongside a broken one — good one still registers", () => {
  writeFixture("good", "---\ndescription: fine.\n---\n\nBody.\n");
  writeFixture("bad", "---\nmodel: main\n---\n\nno description.\n");
  skills.resetCache();
  const found = skills.discover();
  assert.equal(found.size, 1);
  assert.ok(found.has("good"));
  assert.equal(skills.problems().length, 1);
});

test("get: case-insensitive lookup", () => {
  writeFixture("Deploy-Flow", "---\nname: Deploy-Flow\ndescription: x.\n---\n\nBody.\n");
  skills.resetCache();
  assert.ok(skills.get("deploy-flow"));
  assert.ok(skills.get("DEPLOY-FLOW"));
  assert.equal(skills.get("nonexistent"), null);
});

test("indexLines: one '- name: description' line per skill", () => {
  writeFixture("a", "---\ndescription: does a.\n---\n\nx.\n");
  writeFixture("b", "---\ndescription: does b.\n---\n\nx.\n");
  skills.resetCache();
  const lines = skills.indexLines().split("\n").sort();
  assert.deepEqual(lines, ["- a: does a.", "- b: does b."]);
});

test("match: longest name wins so 'deploy' cannot shadow 'deploy-flow'", () => {
  writeFixture("deploy", "---\ndescription: x.\n---\n\nx.\n");
  writeFixture("deploy-flow", "---\ndescription: y.\n---\n\ny.\n");
  skills.resetCache();
  const matched = skills.match("please run the deploy-flow procedure");
  assert.equal(matched?.name, "deploy-flow");
});

test("match: no match returns null, not a throw", () => {
  skills.resetCache();
  assert.equal(skills.match("nothing relevant here"), null);
});

test("render: formats a skill with its directory named for bundled-file references", () => {
  writeFixture("x", "---\ndescription: does x.\n---\n\nRun this.\n");
  skills.resetCache();
  const skill = skills.get("x")!;
  const rendered = skills.render(skill);
  assert.match(rendered, /^--- skill: x ---/);
  assert.match(rendered, /does x\./);
  assert.match(rendered, new RegExp(skill.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered, /Run this\./);
  assert.match(rendered, /--- end skill: x ---$/);
});

test("write: rejects a path-traversal name", () => {
  assert.throws(() => skills.write({ name: "../../.bashrc", description: "x", body: "x" }), /must start with/);
});

test("write: rejects a name with spaces", () => {
  assert.throws(() => skills.write({ name: "Bad Name", description: "x", body: "x" }), /must start with/);
});

test("write: rejects an empty description", () => {
  assert.throws(() => skills.write({ name: "ok-name", description: "", body: "x" }), /description is required/);
});

test("write: rejects an empty body", () => {
  assert.throws(() => skills.write({ name: "ok-name", description: "x", body: "" }), /body is required/);
});

test("write: rejects an invalid model", () => {
  assert.throws(
    () => skills.write({ name: "ok-name", description: "x", body: "x", model: "bogus" }),
    /model must be one of/
  );
});

test("write: a multi-line description is folded to one line, not truncated", () => {
  const written = skills.write({ name: "ok-name", description: "line one\nline two", body: "do the thing" });
  assert.equal(written.description, "line one line two");
  assert.doesNotMatch(written.description, /\n/);
});

test("write: refuses to overwrite an existing skill unless told to", () => {
  skills.write({ name: "dup", description: "first", body: "x" });
  assert.throws(() => skills.write({ name: "dup", description: "second", body: "y" }), /already exists/);
  const overwritten = skills.write({ name: "dup", description: "second", body: "y", overwrite: true });
  assert.equal(overwritten.description, "second");
});

test("write: round-trips through the real parser — get() after write() returns the same data", () => {
  const written = skills.write({ name: "new-skill", description: "does new things.", body: "1. step" });
  const reread = skills.get("new-skill");
  assert.deepEqual(reread, written);
});

// ---------- seedDefaultSkills ----------

test("seedDefaultSkills: creates the directory and writes every bundled skill when it doesn't exist yet", () => {
  const fresh = join(tmp, "genuinely-fresh"); // nested under tmp, so it does NOT exist yet
  skills.setSkillsDir(fresh);

  skills.seedDefaultSkills();

  const found = skills.discover();
  assert.equal(found.size, DEFAULT_SKILLS.length);
  for (const s of DEFAULT_SKILLS) {
    assert.ok(found.has(s.name), `${s.name} must be discovered after seeding`);
  }
});

test("seedDefaultSkills: a no-op when the directory already exists, even if empty — never re-seeds", () => {
  // beforeEach already pointed SKILLS_DIR at `tmp`, which mkdtempSync just
  // created — existing-but-empty is exactly the case that must NOT seed.
  skills.seedDefaultSkills();
  assert.equal(skills.discover().size, 0);
});

test("seedDefaultSkills: never throws, even when it can't actually write (e.g. an ancestor path segment is a file, not a directory)", () => {
  const blocker = join(tmp, "blocker-file");
  writeFileSync(blocker, "not a directory");
  skills.setSkillsDir(join(blocker, "skills")); // mkdirSync(..., {recursive:true}) must fail here (ENOTDIR)

  assert.doesNotThrow(() => skills.seedDefaultSkills());
});

test("DEFAULT_SKILLS: every bundled skill is itself well-formed (parses, has a valid name/description/model)", () => {
  for (const s of DEFAULT_SKILLS) {
    const { meta, body } = skills.parseFrontmatter(s.content);
    assert.ok(meta.description, `${s.name} needs a description`);
    assert.ok(body.trim(), `${s.name} needs a non-empty body`);
    assert.ok(skills.VALID_MODELS.includes((meta.model ?? "any") as any), `${s.name}'s model must be valid`);
    assert.equal(meta.name, s.name);
  }
});
