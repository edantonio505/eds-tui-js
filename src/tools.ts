import type { Tool } from "ollama";

// Ported 1:1 from eds_tui/main.py's RUN_COMMAND_TOOL / DELEGATE_TOOL /
// LOAD_SKILL_TOOL / CREATE_SKILL_TOOL — same names, descriptions and JSON
// schemas, since these strings are read by the model, not just by code.

export const RUN_COMMAND_TOOL: Tool = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Execute a shell command in the user's terminal and return its output. " +
      "Use this to find files, list directories, check system info, run programs, etc.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g. 'find / -name myfile 2>/dev/null')",
        },
      },
      required: ["command"],
    },
  },
};

export const DELEGATE_TOOL: Tool = {
  type: "function",
  function: {
    name: "delegate_task",
    description:
      "Hand a small, self-contained subtask to a faster assistant that has the same shell " +
      "access you do. Use it for mechanical legwork — gathering listings, counting things, " +
      "checking status, reading a value out of a file — so you can stay focused on the " +
      "harder reasoning. It cannot see your conversation, so give it one complete " +
      "instruction. It returns a short text report of what it found.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "A complete, self-contained instruction, e.g. 'Count the lines in every " +
            "*.py file in the current directory and report the totals'",
        },
      },
      required: ["task"],
    },
  },
};

export const LOAD_SKILL_TOOL: Tool = {
  type: "function",
  function: {
    name: "load_skill",
    description:
      "Load the full instructions for one of the skills listed in your system prompt. " +
      "Use it when the request matches a skill's description and you have not already " +
      "been given that skill's text. Returns the skill's procedure, which you then follow.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The skill's name, exactly as listed in your system prompt",
        },
      },
      required: ["name"],
    },
  },
};

export const CREATE_SKILL_TOOL: Tool = {
  type: "function",
  function: {
    name: "create_skill",
    description:
      "Save a reusable procedure as a skill, so it is available in later runs without " +
      "the user explaining it again. Use it when the user asks you to remember how to " +
      "do something, or to write or update a skill. The file is written and then " +
      "re-read to confirm it registers, and you are told either way.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short lowercase identifier, e.g. 'git-cleanup'. Letters, digits, " +
            "dots, dashes and underscores only.",
        },
        description: {
          type: "string",
          description:
            "One line saying when to reach for this skill. This is the only text " +
            "matched against future requests, so name the specific subject rather " +
            "than describing it in general terms.",
        },
        body: {
          type: "string",
          description:
            "The procedure itself, in Markdown. Write it for someone who has a " +
            "shell but was not part of this conversation.",
        },
        model: {
          type: "string",
          description:
            "Which model should run it: 'main' for reasoning-heavy work, 'small' " +
            "for mechanical work, 'any' to let triage decide. Defaults to 'any'.",
        },
        overwrite: {
          type: "boolean",
          description: "Set true to replace a skill that already exists.",
        },
      },
      required: ["name", "description", "body"],
    },
  },
};

// Sub-agent and small model: shell only. Mirrors SHELL_TOOLS in main.py.
export const SHELL_TOOLS: Tool[] = [RUN_COMMAND_TOOL];
