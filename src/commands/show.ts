import type { CommandModule } from "../cli/router.js";
import { emitKV, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { bearerFor, show } from "../crswd/sessions.js";

const ORDER = [
  "id",
  "name",
  "state",
  "work_dir",
  "start_command",
  "adopted",
  "created_at",
  "last_activity",
  "expires_at",
];

export const showCommand: CommandModule = {
  spec: {
    name: "show",
    summary: "One session in full",
    args: [{ name: "id", required: true, description: "session id, from `crswd-axi list`" }],
    flags: [
      {
        name: "token",
        type: "string",
        description: "bearer to use instead of the one on record",
      },
    ],
    examples: ["crswd-axi show 01K5...", "crswd-axi show 01K5... --token <bearer>"],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    const bearer = await bearerFor(id, parsed.flags["token"] as string | undefined);
    const session = await show(id, bearer);

    const pairs: Array<[string, unknown]> = [];
    for (const key of ORDER) {
      const value = (session as unknown as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== "") pairs.push([key, value]);
    }
    print(emitKV(pairs));
    // A detail view is self-contained, but these two are what a caller does
    // next with a session it has just looked up.
    print(helpBlock([`crswd-axi output ${id} --tail 40`, `crswd-axi prompt ${id} "..."`]));
    return 0;
  },
};
