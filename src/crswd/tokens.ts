// The bearer store. This is the part of crswd-axi that callers most need it
// to do for them, and the part that is unforgiving if it is done wrong.
//
// WHY A STORE AT ALL
//
// Four of the six routes need a per-session bearer, and crswd puts a plaintext
// bearer into exactly two responses in a session's whole life:
//
//   * the `POST /sessions` reply, for the session it just created; and
//   * ONE `GET /sessions` reply, for a session the daemon adopted when it
//     restarted -- crswd mints that token, hands it over, and marks the
//     credential claimed. `Manager.ClaimPending`: "Each token is returned by
//     exactly one call; a second asks about nothing."
//
// There is no re-issue path. A restart invalidates every bearer anyone holds,
// so the next list is the only chance to learn the new ones -- and a lister
// that parses id and name and drops `token` burns that chance permanently. The
// session keeps running and becomes undrivable by anybody until it expires.
// That has happened here: 12 of 13 live sessions, uncloseable, measured.
//
// So: every list in this tool captures before it renders. There is no code
// path that sees a token and does not write it down.
//
// WHY THE ROWS ARE CLONED RATHER THAN REPLACED
//
// The store is append-only JSONL, read newest-last. A re-mint changes the
// TOKEN and nothing else, so a new row is built from the session's most recent
// row with the token swapped -- any other field a previous writer put there is
// carried forward untouched. That is what makes it safe to point
// CRSWD_AXI_TOKENS at a store some other tool also writes: this tool never
// blanks a field it does not understand.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Row {
  id: string;
  name?: string;
  token: string;
  token_at?: string;
  [other: string]: unknown;
}

export const DEFAULT_STORE = join(
  process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state"),
  "crswd-axi",
  "tokens.jsonl",
);

/**
 * Every store file, in order. Reads merge across all of them; writes go to all
 * of them. A colon-separated list lets one box share a store with another tool
 * that already holds these tokens, rather than the two racing for the one
 * response that carries them.
 */
export function stores(): string[] {
  const raw = process.env["CRSWD_AXI_TOKENS"];
  if (!raw) return [DEFAULT_STORE];
  return raw
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p));
}

function readRows(path: string): Row[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const row = parsed as Row;
        if (typeof row.id === "string" && row.id) rows.push(row);
      }
    } catch {
      // A store several processes append to can be torn mid-line. One
      // unreadable row is not a reason to lose the rest.
    }
  }
  return rows;
}

/** Session id -> its most recent row, across every configured store. */
function latest(): Map<string, Row> {
  const byId = new Map<string, Row>();
  for (const path of stores()) {
    for (const row of readRows(path)) byId.set(row.id, row);
  }
  return byId;
}

export function tokenFor(id: string): string | undefined {
  const row = latest().get(id);
  const token = row?.token;
  return typeof token === "string" && token ? token : undefined;
}

export interface Minted {
  id: string;
  name?: string;
  token: string;
}

/**
 * Write down every token in `minted`, cloning whatever the store already said
 * about that session. Returns how many rows were written.
 *
 * Never throws. This runs inside the read path of `list`, and a store that
 * cannot be written must not take the listing down with it -- the caller still
 * needs to see its sessions. `list --store-status` reports the write instead.
 */
export function capture(minted: Minted[], nowIso?: string): number {
  const rows = minted.filter((m) => m && m.id && m.token);
  if (rows.length === 0) return 0;
  const prior = latest();
  const stamp = nowIso ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const lines = rows.map((m) => {
    const base: Row = { ...(prior.get(m.id) ?? ({} as Row)) };
    base.id = m.id;
    if (m.name) base.name = m.name;
    base.token = m.token;
    base.token_at = stamp;
    return JSON.stringify(base);
  });

  let written = 0;
  for (const path of stores()) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, lines.join("\n") + "\n", "utf8");
      written += lines.length;
    } catch {
      // Named by `doctor`, not thrown here.
    }
  }
  return written;
}

/** Can the primary store be written? `doctor` asks; nothing else does. */
export function storeWritable(path: string): string | undefined {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "", "utf8");
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
