import type { CommandModule } from "../cli/router.js";
import { emitKV, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { bearerFor, prompt } from "../crswd/sessions.js";

export const promptCommand: CommandModule = {
  spec: {
    name: "prompt",
    summary: "Type into a session and submit",
    args: [
      { name: "id", required: true, description: "session id, from `crswd-axi list`" },
      { name: "text", required: true, description: "what to type; quote it" },
    ],
    flags: [
      { name: "token", type: "string", description: "bearer to use instead of the one on record" },
    ],
    examples: [
      'crswd-axi prompt 01K5... "run the tests and report what failed"',
      'crswd-axi prompt 01K5... "/compact"',
    ],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    // Everything after the id is the prompt, so an unquoted sentence still
    // arrives whole rather than as its first word.
    const text = parsed.positionals.slice(1).join(" ");
    const bearer = await bearerFor(id, parsed.flags["token"] as string | undefined);
    const delivery = await prompt(id, text, bearer);

    const pairs: Array<[string, unknown]> = [
      ["id", delivery.id ?? id],
      ["delivered", delivery.delivered === true],
    ];
    // crswd reports what the pane was sitting on when the keystrokes landed.
    // Delivered and parked is not the same fact as delivered and working, and
    // a caller that cannot tell them apart waits on an answer nobody is typing.
    if (delivery.parked_on) pairs.push(["parked_on", delivery.parked_on]);
    if (delivery.suspicious_dialog) pairs.push(["suspicious_dialog", true]);
    print(emitKV(pairs));

    if (delivery.parked_on || delivery.suspicious_dialog) {
      print(
        helpBlock([
          `crswd-axi output ${id} --tail 40   # the pane was on a dialog, read it before assuming the prompt ran`,
        ]),
      );
    } else {
      print(helpBlock([`crswd-axi output ${id} --tail 40`]));
    }
    return 0;
  },
};
