import type { CommandModule } from "../cli/router.js";
import { UsageError } from "../output/errors.js";
import { emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { list } from "../crswd/sessions.js";

const FIELDS = [
  "id",
  "name",
  "state",
  "work_dir",
  "created_at",
  "expires_at",
  "last_activity",
  "start_command",
  "adopted",
];

export const listCommand: CommandModule = {
  spec: {
    name: "list",
    summary: "Every session crswd has, capturing any bearer it hands over",
    flags: [
      {
        name: "state",
        type: "string",
        description: "only sessions in this state (e.g. running, needs-auth)",
      },
      {
        name: "fields",
        type: "string",
        default: "id,name,state",
        description: `comma-separated columns from: ${FIELDS.join(", ")}`,
      },
    ],
    examples: [
      "crswd-axi list",
      "crswd-axi list --state needs-auth",
      "crswd-axi list --fields id,name,work_dir,expires_at",
    ],
  },
  async run(parsed) {
    const fields = String(parsed.flags["fields"])
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    for (const f of fields) {
      if (!FIELDS.includes(f)) {
        throw new UsageError(
          `unknown field '${f}' for --fields`,
          `valid fields: ${FIELDS.join(", ")}`,
        );
      }
    }

    const { sessions, captured } = await list();
    const state = parsed.flags["state"] as string | undefined;
    const rows = sessions.filter((s) => state === undefined || s.state === state);

    if (rows.length === 0) {
      print(
        state === undefined
          ? "sessions: 0 open — crswd has no sessions"
          : `sessions: 0 in state '${state}' — crswd has ${sessions.length} open`,
      );
      print(helpBlock(["crswd-axi list", "crswd-axi create <name> --work-dir <abs-path>"]));
      return 0;
    }

    print(
      emitList(
        "sessions",
        rows.map((s) => ({ ...s })),
        fields,
        { total: sessions.length },
      ),
    );
    if (captured > 0) {
      // Worth one line: this response was the last chance to learn those
      // bearers, and a reader needs to know the chance was taken.
      print(`captured: ${captured} re-minted bearer${captured === 1 ? "" : "s"} written to the token store`);
    }
    print(
      helpBlock([
        `crswd-axi show ${rows[0]!.id}`,
        `crswd-axi output ${rows[0]!.id} --tail 40`,
      ]),
    );
    return 0;
  },
};
