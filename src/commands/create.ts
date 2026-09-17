import type { CommandModule } from "../cli/router.js";
import { UsageError } from "../output/errors.js";
import { emitKV, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { create } from "../crswd/sessions.js";

export const createCommand: CommandModule = {
  spec: {
    name: "create",
    summary: "Start a session and record the bearer it returns",
    args: [
      {
        name: "name",
        required: true,
        description: "1-64 of [a-zA-Z0-9-]; no ':' or '.'",
      },
    ],
    flags: [
      {
        name: "work-dir",
        type: "string",
        description: "absolute path the session starts in (required)",
      },
      {
        name: "start-command",
        type: "string",
        description: "a start command crswd is configured to allow",
      },
      {
        name: "resume",
        type: "string",
        description: "'latest', or a conversation id, to resume instead of starting fresh",
      },
      {
        name: "lifetime",
        type: "string",
        description: "Go duration such as 72h, or 'never' where crswd permits it",
      },
    ],
    examples: [
      "crswd-axi create review-pr --work-dir /home/me/code/app",
      "crswd-axi create nightly --work-dir /home/me/code/app --lifetime 8h",
    ],
  },
  async run(parsed) {
    const name = parsed.positionals[0]!;
    const workDir = parsed.flags["work-dir"] as string | undefined;
    if (!workDir) {
      throw new UsageError(
        "--work-dir is required",
        "crswd-axi create <name> --work-dir /absolute/path",
      );
    }
    const session = await create({
      name,
      workDir,
      startCommand: parsed.flags["start-command"] as string | undefined,
      resume: parsed.flags["resume"] as string | undefined,
      lifetime: parsed.flags["lifetime"] as string | undefined,
    });

    // The token is deliberately not printed. It is in the store, which is
    // where every other command looks for it, and stdout here is read by
    // agents whose transcripts are kept.
    print(
      emitKV([
        ["id", session.id],
        ["name", session.name],
        ["state", session.state],
        ["work_dir", session.work_dir],
        ["expires_at", session.expires_at],
        ["bearer", session.token ? "recorded in the token store" : "NOT RETURNED"],
      ]),
    );
    print(
      helpBlock([
        `crswd-axi prompt ${session.id} "..."`,
        `crswd-axi output ${session.id} --tail 40`,
        `crswd-axi close ${session.id}`,
      ]),
    );
    return 0;
  },
};
