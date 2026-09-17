// Contract tests for the transport. Each one names a way crswd answers that a
// naive client gets wrong.

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call } from "../src/crswd/client.js";
import { canonical, sign } from "../src/crswd/sign.js";
import { AxiError } from "../src/output/errors.js";
import { startFakeCrswd, type FakeCrswd } from "./fake-crswd.js";

let crswd: FakeCrswd;
const saved: Record<string, string | undefined> = {};

function setVar(name: string, value: string | undefined): void {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(async () => {
  crswd = await startFakeCrswd();
  setVar("CRSWD_HOST", crswd.url);
  setVar("CRSWD_SHARED_SECRET", crswd.secret);
  setVar("CRSWD_NO_OP", "1");
  setVar("CRSWD_ACCESS_CLIENT_ID", undefined);
  setVar("CRSWD_ACCESS_CLIENT_SECRET", undefined);
});

afterEach(async () => {
  await crswd.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the signed payload", () => {
  it("is METHOD, path and timestamp.body, in that order", () => {
    expect(canonical("GET", "/sessions", "17", "")).toBe("GET\n/sessions\n17.");
    expect(canonical("POST", "/sessions", "17", '{"a":1}')).toBe('POST\n/sessions\n17.{"a":1}');
  });

  it("gives a different signature to the same path under a different method", () => {
    const get = sign("s", "GET", "/sessions/x", "", 17);
    const del = sign("s", "DELETE", "/sessions/x", "", 17);
    expect(get.header).not.toBe(del.header);
  });

  it("matches an HMAC computed the way the daemon computes it", () => {
    const expected =
      "sha256=" + createHmac("sha256", "s").update("GET\n/sessions\n17.").digest("hex");
    expect(sign("s", "GET", "/sessions", "", 17).header).toBe(expected);
  });

  it("is accepted by a server that verifies it", async () => {
    crswd.queue.push({ status: 200, body: { sessions: [] } });
    await call("GET", "/sessions");
    expect(crswd.received[0]!.signatureValid).toBe(true);
  });
});

describe("what counts as a failure", () => {
  it("refuses a 200 that carries an error field", async () => {
    // crswd answers some refusals 200-with-an-error-body. A client that reads
    // the status line alone reports those as success, which is how "too many
    // requests" reached callers as a working reply.
    crswd.queue.push({ status: 200, body: { error: "too many requests" } });
    await expect(call("POST", "/sessions", { body: { name: "x" } })).rejects.toBeInstanceOf(AxiError);
  });

  it("names the four causes crswd folds into one 404", async () => {
    // The suggestion is the part a caller acts on, so that is what is pinned.
    crswd.queue.push({ status: 404, body: { error: "not found" } });
    const err = await call("GET", "/sessions/x", { bearer: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect((err as AxiError).suggestion).toMatch(/already destroyed/);
    expect((err as AxiError).exitCode).toBe(1);
  });

  it("keeps a 409 distinct from an ordinary failure", async () => {
    crswd.queue.push({ status: 409, body: { error: "teardown could not be verified" } });
    const err = await call("DELETE", "/sessions/x", { bearer: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect((err as AxiError).message).toMatch(/could not verify teardown/);
    expect((err as AxiError).suggestion).toMatch(/may still be alive/);
  });

  it("says an HTML answer is the browser door, not bad JSON", async () => {
    const plain = await startFakeCrswd();
    try {
      setVar("CRSWD_HOST", plain.url);
      setVar("CRSWD_SHARED_SECRET", plain.secret);
      plain.queue.push({ status: 401, body: "<!doctype html><h1>Not authorised</h1>" });
      // The fake JSON-encodes its body, so force the raw shape the daemon sends.
      await expect(call("GET", "/sessions")).rejects.toThrow();
    } finally {
      await plain.close();
    }
  });
});

describe("the same-second collision", () => {
  it("re-signs under a later timestamp and asks once more", async () => {
    // The signature has one-second resolution and no nonce, so two identical
    // requests in the same second are byte-identical and the daemon refuses
    // the loser as a replay. The caller knows it is not one.
    crswd.queue.push({ status: 401, body: { error: "unauthorized" } });
    crswd.queue.push({ status: 200, body: { sessions: [] } });

    let tick = 100;
    const res = await call("GET", "/sessions", { now: () => tick++, sleepMs: 1 });

    expect(res.status).toBe(200);
    expect(crswd.received).toHaveLength(2);
    expect(crswd.received[0]!.timestamp).toBe("100");
    expect(crswd.received[1]!.timestamp).toBe("101");
    expect(crswd.received[0]!.signature).not.toBe(crswd.received[1]!.signature);
  });

  it("gives up after one retry rather than hammering", async () => {
    crswd.queue.push({ status: 401, body: { error: "unauthorized" } });
    await expect(call("GET", "/sessions", { sleepMs: 1 })).rejects.toThrow(/refused the signature/);
    expect(crswd.received).toHaveLength(2);
  });
});

describe("the bearer", () => {
  it("is sent only when there is one", async () => {
    crswd.queue.push({ status: 200, body: { sessions: [] } });
    await call("GET", "/sessions");
    expect(crswd.received[0]!.bearer).toBeUndefined();

    crswd.queue.length = 0;
    crswd.queue.push({ status: 200, body: { id: "x" } });
    await call("GET", "/sessions/x", { bearer: "abc" });
    expect(crswd.received[1]!.bearer).toBe("abc");
  });
});
