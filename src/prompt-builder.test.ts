import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompt-builder.js";
import type { Skill } from "./types.js";

const BASE = {
  cwd: "/home/edgar/project",
  appDir: "/usr/local/lib/node_modules/eds-tui/dist",
  hardMaxTurns: 14,
  activeModel: "qwen3.8:latest",
  mainModel: "qwen3.8:latest",
};

test("includes cwd, self-location and turn budget in the base prompt", () => {
  const prompt = buildSystemPrompt(BASE);
  assert.match(prompt, /\/home\/edgar\/project/);
  assert.match(prompt, /\/usr\/local\/lib\/node_modules\/eds-tui\/dist/);
  assert.match(prompt, /roughly 14 tool-call rounds/);
  assert.match(prompt, /cli\.ts is the entry point/);
});

test("no skill selected: no 'follow it' section", () => {
  const prompt = buildSystemPrompt(BASE);
  assert.doesNotMatch(prompt, /A skill has been selected/);
});

test("skill selected: rendered body is appended", () => {
  const prompt = buildSystemPrompt({
    ...BASE,
    skill: { name: "deploy-flow", description: "x", model: "any", body: "x", dir: "/tmp" } as Skill,
    renderedSkill: "--- skill: deploy-flow ---\nsteps here\n--- end skill: deploy-flow ---",
  });
  assert.match(prompt, /A skill has been selected for this request\. Follow it\./);
  assert.match(prompt, /steps here/);
});

test("other-skills index only shown when activeModel === mainModel (never for the small model or a sub-agent)", () => {
  const withIndex = { ...BASE, otherSkillsIndex: "- foo: does foo\n- bar: does bar" };

  const forMain = buildSystemPrompt(withIndex);
  assert.match(forMain, /Other skills you can load/);
  assert.match(forMain, /- foo: does foo/);

  const forSmall = buildSystemPrompt({ ...withIndex, activeModel: "ornith:35b" });
  assert.doesNotMatch(forSmall, /Other skills you can load/);
});

test("empty otherSkillsIndex produces no 'other skills' section", () => {
  const prompt = buildSystemPrompt({ ...BASE, otherSkillsIndex: "" });
  assert.doesNotMatch(prompt, /Other skills you can load/);
});
