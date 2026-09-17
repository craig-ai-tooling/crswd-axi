import type { CommandModule } from "../cli/router.js";
import { emitKV, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { bearerFor, close } from "../crswd/sessions.js";

export const closeCommand: CommandModule = {
  spec: {
    name: "close",
    summary: "Destroy a session",
    args: [{ name: "id", required: true, description: "session id, from `crswd-axi list`" }],
    flags: [
      { name: "token", type: "string", description: "bearer to use instead of the one on record" },
    ],
    examples: ["crswd-axi close 01K5..."],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    const bearer = await bearerFor(id, parsed.flags["token"] as string | undefined);
    // Not idempotent, deliberately not hidden: crswd answers a second close
    // with the same 404 it gives an id that never existed, so this tool cannot
    // honestly report "already gone" and does not pretend to. The 404's
    // suggestion says so.
    const result = await close(id, bearer);
    print(
      emitKV([
        ["id", result.id ?? id],
        ["destroyed", result.destroyed === true],
      ]),
    );
    print(helpBlock(["crswd-axi list"]));
    return 0;
  },
};
