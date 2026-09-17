// The AXI contract, driven through the real binary.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/crswd-axi.js", import.meta.url));

// Nothing here may touch a real crswd or a real 1Password. Port 1 refuses
// immediately, which is the fastest honest "cannot reach it" available.
const SEALED = {
  ...process.env,
  CRSWD_HOST: "http://127.0.0.1:1",
  CRSWD_NO_OP: "1",
  CRSWD_SHARED_SECRET: "not-a-real-secret",
};

function run(...args: string[]) {
  return spawnSync("node", [bin, ...args], { encoding: "utf8", env: SEALED });
}

const COMMANDS = [
  "list",
  "show",
  "create",
  "prompt",
  "output",
  "close",
  "doctor",
  "setup status",
];

describe("crswd-axi AXI contract", () => {
  it("no-args shows content and exits 0 (principle 8)", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/^\s*usage[:\s]/i);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });

  it("--help exits 0 and lists flags (principle 10)", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--");
  });

  it("unknown flag exits 2 naming valid flags (principle 6)", () => {
    const r = run("--not-a-real-flag");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error:");
    expect(r.stdout).toContain("--");
  });

  it("stderr is silent on success (principle 6)", () => {
    expect(run().stderr.trim()).toBe("");
  });

  it("--version prints a version, not 'unknown'", () => {
    const r = run("--version");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^crswd-axi: \d+\.\d+\.\d+/);
  });

  it.each(COMMANDS)("`%s --help` exits 0 (V09)", (command) => {
    const r = run(...command.split(" "), "--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("command:");
  });

  it.each(COMMANDS)("`%s` rejects an unknown flag with exit 2 (V10)", (command) => {
    const r = run(...command.split(" "), "--definitely-not-a-flag");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error:");
  });

  it("names every verb the task asked for", () => {
    const r = run("--help");
    for (const verb of ["list", "show", "create", "prompt", "output", "close"]) {
      expect(r.stdout).toContain(verb);
    }
  });
});

describe("a source that cannot be reached", () => {
  it("is reported as unavailable, never rendered as an empty result", () => {
    // The failure this whole tool is written against: "the gateway did not
    // answer" arriving as "there is nothing there". The home view must still
    // exit 0 -- a SessionStart hook runs it -- but it must say so.
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("UNAVAILABLE");
    expect(r.stdout).not.toMatch(/sessions: 0 open/);
  });

  it("makes a command that needed the daemon exit non-zero", () => {
    const r = run("list");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("error:");
  });

  it("makes doctor refuse rather than pass", () => {
    const r = run("doctor");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("connectors");
    expect(r.stdout).toContain("crswd,required,down");
  });
});

describe("arguments crswd would refuse anyway", () => {
  it("rejects a session name with a dot before sending it", () => {
    const r = run("create", "bad.name", "--work-dir", "/tmp");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error:");
  });

  it("requires --work-dir", () => {
    const r = run("create", "goodname");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("--work-dir");
  });

  it("requires an absolute work dir", () => {
    const r = run("create", "goodname", "--work-dir", "relative/path");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("absolute");
  });

  it("requires an id", () => {
    const r = run("close");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("missing required argument");
  });
});
