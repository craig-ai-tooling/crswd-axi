// The no-args view (AXI principle 8): what is live right now, not a manual.
//
// It is also the one command that must not fail. A SessionStart hook may run
// it every turn, and a tool that exits non-zero there is a tool that gets
// removed. So an unreachable daemon is REPORTED here and exits 0 -- what it
// must never do is render as "0 sessions", which is the failure mode this
// whole tool is written against.

import type { CommandModule } from "../cli/router.js";
import { emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { collapseHome, commandTable, DESCRIPTION, rootHelpText } from "../skill/content.js";
import { VERSION } from "../version.js";
import { host } from "../crswd/config.js";
import { list } from "../crswd/sessions.js";

const FIELDS = ["id", "name", "state"];

export const homeCommand: CommandModule = {
  spec: {
    name: "",
    summary: "Live sessions on the crswd this box is pointed at",
    flags: [{ name: "version", type: "boolean", description: "print the tool version" }],
    examples: ["crswd-axi", "crswd-axi --version"],
  },
  async run(parsed) {
    if (parsed.flags["version"]) {
      print(`crswd-axi: ${VERSION}`);
      return 0;
    }

    print(`crswd-axi: ${collapseHome(process.argv[1] ?? "crswd-axi")} — ${DESCRIPTION}`);

    try {
      const { sessions, captured } = await list();
      if (sessions.length === 0) {
        print(`sessions: 0 open on ${host()}`);
      } else {
        print(
          emitList(
            "sessions",
            sessions.slice(0, 10).map((s) => ({ ...s })),
            FIELDS,
            { total: sessions.length },
          ),
        );
        if (captured > 0) {
          print(`captured: ${captured} re-minted bearer${captured === 1 ? "" : "s"} written to the token store`);
        }
      }
      print(helpBlock(["crswd-axi list --fields id,name,state,work_dir", "crswd-axi --help"]));
    } catch (err) {
      // Named, never blank. "crswd unreachable" and "no sessions" are
      // different facts and only one of them is safe to act on.
      const message = err instanceof Error ? err.message : String(err);
      print(`sessions: UNAVAILABLE — ${message}`);
      print(commandTable());
      print(helpBlock(["crswd-axi doctor"]));
    }
    return 0;
  },
};

export function rootHelp(): string {
  return rootHelpText();
}
