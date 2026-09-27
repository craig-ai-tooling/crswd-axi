// The store's whole job is not losing a credential that is handed over once.

import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capture, stores, tokenFor } from "../src/crswd/tokens.js";
import { list } from "../src/crswd/sessions.js";
import { startFakeCrswd, type FakeCrswd } from "./fake-crswd.js";

let dir: string;
let store: string;
const saved: Record<string, string | undefined> = {};

function setVar(name: string, value: string | undefined): void {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function rows(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "crswd-axi-test-"));
  store = join(dir, "tokens.jsonl");
  setVar("CRSWD_AXI_TOKENS", store);
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the store", () => {
  it("reads the newest row for a session", () => {
    capture([{ id: "a", name: "one", token: "first" }]);
    capture([{ id: "a", name: "one", token: "second" }]);
    expect(tokenFor("a")).toBe("second");
  });

  it("carries forward fields it did not write", () => {
    // A re-mint changes the token and nothing else. Anything else in the row
    // belongs to whoever wrote it, and blanking it is how a shared store gets
    // quietly corrupted by the second tool to touch it.
    writeFileSync(
      store,
      JSON.stringify({ id: "a", name: "one", token: "old", item: "01ABC", at: "2026-09-01T00:00:00Z" }) + "\n",
    );
    capture([{ id: "a", name: "one", token: "new" }]);
    const last = rows(store).at(-1)!;
    expect(last["token"]).toBe("new");
    expect(last["item"]).toBe("01ABC");
    expect(last["at"]).toBe("2026-09-01T00:00:00Z");
  });

  it("appends rather than rewriting, so a concurrent writer loses nothing", () => {
    capture([{ id: "a", token: "one" }]);
    capture([{ id: "b", token: "two" }]);
    expect(rows(store)).toHaveLength(2);
    expect(tokenFor("a")).toBe("one");
    expect(tokenFor("b")).toBe("two");
  });

  it("writes every store in the list and reads across all of them", () => {
    const second = join(dir, "other.jsonl");
    setVar("CRSWD_AXI_TOKENS", `${store}:${second}`);
    expect(stores()).toEqual([store, second]);
    capture([{ id: "a", token: "one" }]);
    expect(rows(store)).toHaveLength(1);
    expect(rows(second)).toHaveLength(1);
  });

  it("survives a torn line without losing the rest", () => {
    writeFileSync(store, '{"id":"a","token":"good"}\n{"id":"b","tok\n');
    expect(tokenFor("a")).toBe("good");
    expect(tokenFor("b")).toBeUndefined();
  });

  it("creates the store 0600 and its directory 0700 even under a permissive umask", () => {
    // Found 9/26/26: mkdirSync/appendFileSync with no mode left the bearer store
    // 0664 in a 0775 dir under this box's umask 0002. A bearer is a live credential;
    // group/world readable is wrong regardless of umask.
    const prior = process.umask(0o002);
    try {
      const fresh = join(mkdtempSync(join(tmpdir(), "crswd-axi-test-")), "nested", "tokens.jsonl");
      setVar("CRSWD_AXI_TOKENS", fresh);
      capture([{ id: "a", token: "one" }]);
      expect(statSync(fresh).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(fresh)).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(prior);
    }
  });
});

describe("listing", () => {
  let crswd: FakeCrswd;

  beforeEach(async () => {
    crswd = await startFakeCrswd();
    setVar("CRSWD_HOST", crswd.url);
    setVar("CRSWD_SHARED_SECRET", crswd.secret);
    setVar("CRSWD_NO_OP", "1");
  });

  afterEach(async () => {
    await crswd.close();
  });

  it("writes down a bearer the list carries, because there is no second chance", async () => {
    // crswd puts an adopted session's re-minted token in exactly one list
    // response and never again. A lister that parses id and name and drops
    // `token` leaves that session undrivable until it expires.
    crswd.queue.push({
      status: 200,
      body: {
        sessions: [
          { id: "a", name: "one", state: "running", token: "minted-once" },
          { id: "b", name: "two", state: "running" },
        ],
      },
    });

    const listing = await list();

    expect(listing.sessions).toHaveLength(2);
    expect(listing.captured).toBe(1);
    expect(tokenFor("a")).toBe("minted-once");
    expect(tokenFor("b")).toBeUndefined();
  });
});
