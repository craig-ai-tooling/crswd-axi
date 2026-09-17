// The connector contract: every external thing this tool touches, declared in
// one table, each with a need and a fix.
//
// The rule it enforces is the one that makes the rest of the tool worth
// trusting: a source that cannot be reached is reported as unreachable, never
// rendered as empty. "The gateway did not answer" and "there is nothing there"
// are different facts and only one of them is safe to act on.
//
// Exit: 0 when every REQUIRED connector is ok, 5 when only optional ones are
// absent, 1 when a required one is down.

import type { CommandModule } from "../cli/router.js";
import { emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import * as cfg from "../crswd/config.js";
import { list } from "../crswd/sessions.js";
import { DEFAULT_STORE, storeWritable, stores } from "../crswd/tokens.js";

type Need = "required" | "optional" | "n/a";
type Status = "ok" | "down" | "absent" | "off";

interface Connector {
  name: string;
  need: Need;
  status: Status;
  detail: string;
}

export const doctorCommand: CommandModule = {
  spec: {
    name: "doctor",
    summary: "Probe every connector and name the fix for each gap",
    flags: [],
    examples: ["crswd-axi doctor"],
  },
  async run() {
    const connectors: Connector[] = [];
    const h = cfg.host();
    const loopback = cfg.isLoopback(h);

    // 1. The shared secret. Required: nothing reaches the API without it.
    const secret = cfg.sharedSecret();
    connectors.push({
      name: "secret",
      need: "required",
      status: secret.value ? "ok" : "down",
      detail: secret.value
        ? `present (from ${secret.source}${secret.detail ? `: ${secret.detail}` : ""})`
        : `${secret.detail ?? "not found"} | fix: set CRSWD_SHARED_SECRET, or make \`op read ${process.env["CRSWD_OP_ITEM"] || cfg.DEFAULT_OP_ITEM}/shared-secret\` work`,
    });

    // 2. Cloudflare Access. crswd never reads these -- the edge does -- so they
    //    matter exactly when something is in front of the host.
    if (process.env["CRSWD_ACCESS"] === "off") {
      connectors.push({
        name: "access",
        need: "optional",
        status: "off",
        detail: "disabled (CRSWD_ACCESS=off)",
      });
    } else {
      const id = cfg.accessClientId().value;
      const sec = cfg.accessClientSecret().value;
      const have = Boolean(id && sec);
      connectors.push({
        name: "access",
        need: loopback ? "n/a" : "required",
        status: have ? "ok" : loopback ? "absent" : "down",
        detail: have
          ? "service token present"
          : loopback
            ? `not needed: ${h} is loopback, no Cloudflare in the path`
            : `no CF Access service token | fix: set CRSWD_ACCESS_CLIENT_ID and CRSWD_ACCESS_CLIENT_SECRET, or CRSWD_ACCESS=off if ${h} has no Access policy`,
      });
    }

    // 3. The token store. Required, because a bearer crswd hands over is the
    //    only one it will ever hand over -- a store that cannot be written
    //    means a session that can never be closed.
    const paths = stores();
    const primary = paths[0] ?? DEFAULT_STORE;
    const why = storeWritable(primary);
    connectors.push({
      name: "tokens",
      need: "required",
      status: why ? "down" : "ok",
      detail: why
        ? `${primary}: ${why} | fix: make that path writable, or set CRSWD_AXI_TOKENS to one that is`
        : `${paths.length} store${paths.length === 1 ? "" : "s"}, primary ${primary}`,
    });

    // 4. The daemon itself. Probed with the one call this tool treats as
    //    sanctioned -- it captures, so probing costs no credential.
    let daemon: Connector;
    if (!secret.value) {
      daemon = {
        name: "crswd",
        need: "required",
        status: "down",
        detail: `${h}: not probed, no shared secret to sign with`,
      };
    } else {
      try {
        const listing = await list();
        daemon = {
          name: "crswd",
          need: "required",
          status: "ok",
          detail: `${h}: ${listing.sessions.length} session${listing.sessions.length === 1 ? "" : "s"}${listing.captured ? `, ${listing.captured} bearer(s) captured` : ""}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        daemon = {
          name: "crswd",
          need: "required",
          status: "down",
          detail: `${h}: ${message} | fix: check the daemon is up and CRSWD_HOST is right`,
        };
      }
    }
    connectors.push(daemon);

    print(emitList("connectors", connectors as unknown as Array<Record<string, unknown>>, [
      "name",
      "need",
      "status",
      "detail",
    ]));

    const requiredDown = connectors.some((c) => c.need === "required" && c.status !== "ok");
    const optionalAbsent = connectors.some((c) => c.need === "optional" && c.status === "absent");

    if (requiredDown) {
      print("verdict: a required connector is not reachable");
      print(helpBlock(["crswd-axi doctor   # after applying the fix above"]));
      return 1;
    }
    if (optionalAbsent) {
      print("verdict: usable, with an optional connector absent");
      return 5;
    }
    print("verdict: every required connector is ok");
    print(helpBlock(["crswd-axi list"]));
    return 0;
  },
};
