// SessionStart hooks, so an agent is told this tool exists before it reaches
// for curl.
//
// This is not decoration. gh-axi was installed on this box and signed in, and
// over the next 30 days sessions still made 3,371 raw `gh` calls, a fifth of
// them failing, because nothing named the tool at session start. The same
// count for crswd is 364 raw `curl` calls, 25.5% failing. A tool nobody is
// told about is a tool nobody uses.
//
// Installing is a WRITE to an agent's own config, so it is its own command and
// never a side effect of an ordinary one. `setup status` reports and writes
// nothing.

import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import type { CommandModule } from "../cli/router.js";
import { emitKV, emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";

const IDENTITY = { marker: "crswd-axi", binaryNames: ["crswd-axi"] };

type Scope = "user" | "project";

function scopeOf(parsed: { flags: Record<string, string | boolean> }): Scope {
  return parsed.flags["scope"] === "project" ? "project" : "user";
}

const SCOPE_FLAG = {
  name: "scope",
  type: "string" as const,
  default: "user",
  values: ["user", "project"],
  description: "the agent config to target",
};

function statusRows(scope: Scope): Array<Record<string, unknown>> {
  const status = sessionStartHookStatus({ ...IDENTITY, scope }) as unknown as Record<
    string,
    { installed?: boolean; path?: string } | unknown
  >;
  const rows: Array<Record<string, unknown>> = [];
  for (const agent of ["claude", "codex", "opencode"]) {
    const entry = status[agent] as { installed?: boolean; path?: string } | undefined;
    rows.push({
      agent,
      installed: entry?.installed === true,
      path: entry?.path ?? "",
    });
  }
  return rows;
}

export const setupStatus: CommandModule = {
  spec: {
    name: "setup status",
    summary: "Where the crswd-axi SessionStart hook is installed, writing nothing",
    flags: [SCOPE_FLAG],
    examples: ["crswd-axi setup status", "crswd-axi setup status --scope project"],
  },
  run(parsed) {
    const scope = scopeOf(parsed);
    print(`scope: ${scope}`);
    print(emitList("hooks", statusRows(scope), ["agent", "installed", "path"]));
    print(helpBlock(["crswd-axi setup hooks"]));
    return 0;
  },
};

export const setupHooks: CommandModule = {
  spec: {
    name: "setup hooks",
    summary: "Install the SessionStart hook that shows live sessions to an agent",
    flags: [SCOPE_FLAG],
    examples: ["crswd-axi setup hooks", "crswd-axi setup hooks --scope project"],
  },
  async run(parsed) {
    const scope = scopeOf(parsed);
    await installSessionStartHooks({ ...IDENTITY, scope });
    print(emitKV([["setup", `hooks installed or already up to date (${scope} scope)`]]));
    print(emitList("hooks", statusRows(scope), ["agent", "installed", "path"]));
    print(helpBlock(["crswd-axi setup status", "crswd-axi setup remove"]));
    return 0;
  },
};

export const setupRemove: CommandModule = {
  spec: {
    name: "setup remove",
    summary: "Remove the crswd-axi SessionStart hook, leaving other hooks alone",
    flags: [SCOPE_FLAG],
    examples: ["crswd-axi setup remove"],
  },
  async run(parsed) {
    const scope = scopeOf(parsed);
    await uninstallSessionStartHooks({ ...IDENTITY, scope });
    print(emitKV([["setup", `hooks removed where present (${scope} scope)`]]));
    print(emitList("hooks", statusRows(scope), ["agent", "installed", "path"]));
    return 0;
  },
};
