// One signed call to crswd, and an honest verdict about what came back.
//
// THE BUG THIS MODULE EXISTS TO NOT HAVE.
//
// The shell client this replaces prints the response body and exits 0 whatever
// the body says. crswd answers some failures with HTTP 200 and an `error` field
// -- so `{"error":"too many requests"}` arrived at every caller as a success.
// Two of them (retire-sessions, reap-sessions) carry a comment saying exactly
// that and re-check the body by hand. A check that cannot pass must refuse;
// so here, a body with an `error` field is an error, whatever the status line.

import { AxiError } from "../output/errors.js";
import * as cfg from "./config.js";
import { sign } from "./sign.js";

export interface Response {
  status: number;
  body: Record<string, unknown>;
}

export interface CallOptions {
  body?: unknown;
  bearer?: string;
  /** Test seam: the seconds counter the signature is built from. */
  now?: () => number;
  /** Test seam: what to sleep before the one 401 retry. */
  sleepMs?: number;
}

function requireSecret(): string {
  const found = cfg.sharedSecret();
  if (!found.value) {
    throw new AxiError(
      `no crswd shared secret (${found.detail ?? found.source})`,
      "set CRSWD_SHARED_SECRET, or make `op read " +
        (process.env["CRSWD_OP_ITEM"] || cfg.DEFAULT_OP_ITEM) +
        "/shared-secret` work",
    );
  }
  return found.value;
}

function accessHeaders(): Record<string, string> {
  // Sent when they resolve, omitted when they do not. They are Cloudflare's
  // to read, never crswd's, so a loopback call with none is complete and a
  // tunnelled call with none fails at the edge -- which `doctor` predicts.
  const id = cfg.accessClientId().value;
  const secret = cfg.accessClientSecret().value;
  if (!id || !secret) return {};
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a failed call means, in words that name the next move. */
function failure(method: string, path: string, res: Response): AxiError {
  const said = typeof res.body["error"] === "string" ? (res.body["error"] as string) : "";
  const where = `${method} ${path}`;

  if (res.status === 401) {
    return new AxiError(
      `crswd refused the signature on ${where}`,
      "the secret is wrong, this host's clock is more than 300s from crswd's, " +
        "or the same request was already signed in this second (retried once already)",
    );
  }
  if (res.status === 404) {
    return new AxiError(
      `crswd has no such session for this caller: ${where}`,
      "crswd answers one 404 for all of: unknown id, another caller's session, " +
        "a wrong or expired bearer, and a session already destroyed. " +
        "Run `crswd-axi list` to see what exists",
    );
  }
  if (res.status === 409) {
    return new AxiError(
      `crswd could not verify teardown of ${where}`,
      "the tmux session may still be alive -- check it before assuming the " +
        "session is gone, then retry the close",
    );
  }
  if (res.status === 429 || said === "too many requests") {
    return new AxiError(
      "crswd refused: too many requests",
      "the session cap is reached, or creates are over 6/min (burst 3). " +
        "crswd answers both the same way -- run `crswd-axi list` to tell them apart",
    );
  }
  if (res.status === 400) {
    return new AxiError(
      `crswd refused the request body on ${where}`,
      "a name must match ^[a-zA-Z0-9-]{1,64}$, a work-dir must be an existing " +
        "absolute path under a root crswd approves, and unknown JSON fields are rejected",
    );
  }
  return new AxiError(
    `crswd answered ${res.status} on ${where}${said ? `: ${said}` : ""}`,
    "run `crswd-axi doctor` to check the daemon, the secret and the token store",
  );
}

export async function call(
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<Response> {
  const secret = requireSecret();
  const base = cfg.host();
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    throw new AxiError(`not a usable crswd host: ${base}`, "set CRSWD_HOST to a URL, e.g. http://127.0.0.1:8765");
  }
  const rawBody = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  const send = async (): Promise<Response> => {
    const sig = sign(secret, method, url.pathname, rawBody, now());
    const headers: Record<string, string> = {
      "X-CRSW-Timestamp": sig.timestamp,
      "X-CRSW-Signature": sig.header,
      ...accessHeaders(),
    };
    if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
    if (rawBody) headers["Content-Type"] = "application/json";

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: rawBody || undefined,
        signal: AbortSignal.timeout(cfg.timeoutMs()),
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new AxiError(
        `crswd did not answer at ${base}: ${why}`,
        "check the daemon is up (`systemctl --user status crswd`) and CRSWD_HOST is right",
      );
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    if (text.trim()) {
      try {
        const parsed: unknown = JSON.parse(text);
        body =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
      } catch {
        // An HTML body here is crswd's browser door answering, which means the
        // request never reached the API at all. Saying "invalid JSON" would
        // hide that, so name what it actually is.
        throw new AxiError(
          `crswd answered ${res.status} with ${text.trimStart().startsWith("<") ? "an HTML page" : "non-JSON"}`,
          "that is the dashboard door, not the API -- check CRSWD_HOST points at the daemon",
        );
      }
    }
    return { status: res.status, body };
  };

  let res = await send();
  if (res.status === 401) {
    // One retry under a later timestamp. The signature has one-second
    // resolution and no nonce, so a caller that lost a same-second collision
    // is refused as a replay; it knows it is not one. Randomised, so two
    // callers that both lost to a third do not line up again.
    await sleep(opts.sleepMs ?? 1000 + Math.floor(Math.random() * 1000));
    res = await send();
  }

  if (res.status >= 400 || typeof res.body["error"] === "string") {
    throw failure(method, url.pathname, res);
  }
  return res;
}
