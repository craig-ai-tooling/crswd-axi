// Where crswd is, and what proves a request to it.
//
// Two independent doors, and they are not interchangeable. The HMAC signature
// is what the DAEMON checks, on every one of the six API routes. The
// CF-Access-Client-* pair is what CLOUDFLARE's edge checks, and crswd's own
// code never reads it -- internal/httpapi/server.go routes the six through
// s.authenticate alone. So Access credentials are needed exactly when a
// Cloudflare Tunnel sits in front of the host, and never otherwise, which is
// why doctor computes that need from the host rather than fixing it.

import { execFileSync } from "node:child_process";

export const DEFAULT_HOST = "http://127.0.0.1:8765";
export const DEFAULT_OP_ITEM = "op://Lobster/crswd";

export interface Resolved {
  value?: string;
  /** Where it was looked for, for doctor. Never the value itself. */
  source: string;
  detail?: string;
}

export function host(): string {
  return process.env["CRSWD_HOST"] || DEFAULT_HOST;
}

/**
 * Is this the daemon on our own machine?
 *
 * Loopback needs no Cloudflare credentials because there is no Cloudflare in
 * the path. Wrong in one direction costs a warning; wrong in the other means
 * signing a request and sending it to someone else's deployment.
 */
export function isLoopback(h: string = host()): boolean {
  let name: string;
  try {
    name = new URL(h).hostname;
  } catch {
    return false;
  }
  if (name === "localhost" || name === "::1" || name === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

function opRead(field: string): Resolved {
  const item = process.env["CRSWD_OP_ITEM"] || DEFAULT_OP_ITEM;
  const ref = `${item}/${field}`;
  try {
    const out = execFileSync("op", ["read", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
    const value = out.trim();
    if (!value) return { source: "op", detail: `${ref} is empty` };
    return { value, source: "op", detail: ref };
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { source: "op", detail: `${ref}: ${why}` };
  }
}

function fromShellOrOp(varName: string, opField: string): Resolved {
  const supplied = process.env[varName];
  if (supplied) return { value: supplied, source: "shell", detail: varName };
  if (process.env["CRSWD_NO_OP"] === "1") {
    return { source: "shell", detail: `${varName} unset and CRSWD_NO_OP=1` };
  }
  return opRead(opField);
}

export function sharedSecret(): Resolved {
  return fromShellOrOp("CRSWD_SHARED_SECRET", "shared-secret");
}

export function accessClientId(): Resolved {
  return fromShellOrOp("CRSWD_ACCESS_CLIENT_ID", "access-client-id");
}

export function accessClientSecret(): Resolved {
  return fromShellOrOp("CRSWD_ACCESS_CLIENT_SECRET", "access-client-secret");
}

/** Milliseconds to wait on any one HTTP call. */
export function timeoutMs(): number {
  const raw = process.env["CRSWD_TIMEOUT_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}
