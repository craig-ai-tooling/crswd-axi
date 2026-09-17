import type { CommandModule } from "../cli/router.js";
import { UsageError } from "../output/errors.js";
import { print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { truncate, truncationNote } from "../output/truncate.js";
import { bearerFor, output } from "../crswd/sessions.js";

export const outputCommand: CommandModule = {
  spec: {
    name: "output",
    summary: "What the session's pane currently shows",
    args: [{ name: "id", required: true, description: "session id, from `crswd-axi list`" }],
    flags: [
      { name: "token", type: "string", description: "bearer to use instead of the one on record" },
      {
        name: "tail",
        type: "string",
        description: "keep only the last N lines (crswd has no such parameter; this is local)",
      },
      { name: "full", type: "boolean", description: "print the whole capture, however long" },
    ],
    examples: [
      "crswd-axi output 01K5... --tail 40",
      "crswd-axi output 01K5... --full",
    ],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    const tailRaw = parsed.flags["tail"] as string | undefined;
    let tail: number | undefined;
    if (tailRaw !== undefined) {
      tail = Number(tailRaw);
      if (!Number.isInteger(tail) || tail <= 0) {
        throw new UsageError(`--tail must be a positive whole number, got '${tailRaw}'`, "--tail 40");
      }
    }

    const bearer = await bearerFor(id, parsed.flags["token"] as string | undefined);
    const capture = await output(id, bearer);
    const whole = capture.text ?? "";

    let text = whole;
    if (tail !== undefined) {
      const lines = whole.split("\n");
      text = lines.slice(Math.max(0, lines.length - tail)).join("\n");
    }

    print(`output: ${capture.id ?? id}`);
    if (capture.captured_at) print(`captured_at: ${capture.captured_at}`);

    if (!whole.trim()) {
      // An empty pane is a fact about the session, not a missing answer.
      print("text: 0 chars — the pane is empty");
      print(helpBlock([`crswd-axi show ${id}`]));
      return 0;
    }

    const full = parsed.flags["full"] === true;
    const shown = full ? { text, truncated: false, totalChars: text.length } : truncate(text, 1200);
    print("text:");
    for (const line of shown.text.split("\n")) print("  " + line);
    if (shown.truncated) {
      print(truncationNote(shown));
      print(helpBlock([`crswd-axi output ${id} --full`]));
    } else if (tail !== undefined && whole.length > text.length) {
      print(helpBlock([`crswd-axi output ${id} --full`]));
    }
    return 0;
  },
};
