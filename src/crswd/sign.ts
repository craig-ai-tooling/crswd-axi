// The canonical string crswd signs, byte for byte.
//
//     METHOD \n EscapedPath \n timestamp "." rawBody
//
// Three things about it have bitten callers and all three are load-bearing:
//
//   * The METHOD and PATH are inside the payload. Without them a signed
//     `GET /sessions/x` would also be a valid `DELETE /sessions/x` in the same
//     second -- a read that doubles as a destroy.
//   * The path is the ESCAPED path, the bytes on the wire, not a decoded form.
//     Decode-then-sign produces a signature the daemon cannot reproduce.
//   * The timestamp has one-second resolution and there is no nonce. Two
//     identical requests in the same second sign identically, and the daemon's
//     replay cache refuses the second one. That is correct of it -- it cannot
//     tell a collision from a captured request -- so the caller, which knows it
//     has only just issued this, re-signs later and asks again. See client.ts.

import { createHmac } from "node:crypto";

export interface Signature {
  timestamp: string;
  header: string;
}

export function canonical(
  method: string,
  escapedPath: string,
  timestamp: string,
  rawBody: string,
): string {
  return `${method}\n${escapedPath}\n${timestamp}.${rawBody}`;
}

export function sign(
  secret: string,
  method: string,
  escapedPath: string,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Signature {
  const timestamp = String(nowSeconds);
  const digest = createHmac("sha256", secret)
    .update(canonical(method, escapedPath, timestamp, rawBody))
    .digest("hex");
  return { timestamp, header: `sha256=${digest}` };
}
