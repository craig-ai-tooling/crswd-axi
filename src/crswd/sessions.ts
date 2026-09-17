// The six routes, as functions. Everything above this layer works in plain
// objects and never builds a JSON body or resolves a bearer by hand.

import { AxiError, UsageError } from "../output/errors.js";
import { call } from "./client.js";
import { capture, tokenFor, type Minted } from "./tokens.js";

export interface Session {
  id: string;
  name?: string;
  work_dir?: string;
  state?: string;
  created_at?: string;
  expires_at?: string;
  last_activity?: string;
  start_command?: string;
  adopted?: boolean;
  /** Present on a create reply, and on the one list that adopts a session. */
  token?: string;
}

export interface Listing {
  sessions: Session[];
  /** How many bearers this call was the last chance to learn. */
  captured: number;
}

/** crswd's own rule for a session name, checked here to save a round trip. */
export const NAME_RE = /^[a-zA-Z0-9-]{1,64}$/;

function asSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is Session => !!s && typeof s === "object" && typeof (s as Session).id === "string",
  );
}

function minted(sessions: Session[]): Minted[] {
  const out: Minted[] = [];
  for (const s of sessions) {
    if (typeof s.token === "string" && s.token) {
      out.push({ id: s.id, name: s.name, token: s.token });
    }
  }
  return out;
}

/**
 * GET /sessions, capturing before returning.
 *
 * The capture is not optional and not a flag. This response is the only place
 * an adopted session's re-minted bearer will ever appear; a caller that lists
 * without capturing destroys it. See tokens.ts.
 */
export async function list(): Promise<Listing> {
  const res = await call("GET", "/sessions");
  const sessions = asSessions(res.body["sessions"]);
  const captured = capture(minted(sessions));
  return { sessions, captured };
}

/**
 * The bearer for a session, found or fetched.
 *
 * Order: what the caller passed, then the store, then one capturing list --
 * which is also the call that would have minted it, so asking costs nothing
 * that was not already going to be spent.
 */
export async function bearerFor(id: string, supplied?: string): Promise<string> {
  if (supplied) return supplied;
  const known = tokenFor(id);
  if (known) return known;

  const listing = await list();
  const fresh = tokenFor(id);
  if (fresh) return fresh;

  const exists = listing.sessions.some((s) => s.id === id);
  if (!exists) {
    throw new AxiError(
      `crswd does not list a session ${id}`,
      "run `crswd-axi list` to see what exists",
    );
  }
  throw new AxiError(
    `no bearer on record for ${id}, and crswd will not mint another`,
    "crswd hands a session's bearer over exactly once. If it was taken by a " +
      "caller that did not write it down, this session cannot be driven again " +
      "and will sit until it expires -- `crswd-axi list --fields id,name,expires_at`",
  );
}

export interface CreateInput {
  name: string;
  workDir: string;
  startCommand?: string;
  resume?: string;
  lifetime?: string;
}

/** POST /sessions. The reply carries the only bearer this session ever gets. */
export async function create(input: CreateInput): Promise<Session> {
  if (!NAME_RE.test(input.name)) {
    throw new UsageError(
      `'${input.name}' is not a session name crswd accepts`,
      "names are 1-64 of [a-zA-Z0-9-]; ':' and '.' are tmux target syntax and are refused",
    );
  }
  if (!input.workDir.startsWith("/")) {
    throw new UsageError(
      `--work-dir must be absolute, got '${input.workDir}'`,
      "crswd resolves it through symlinks and refuses anything outside a root it approves",
    );
  }
  const body: Record<string, string> = { name: input.name, work_dir: input.workDir };
  if (input.startCommand) body["start_command"] = input.startCommand;
  if (input.resume) body["resume"] = input.resume;
  if (input.lifetime) body["lifetime"] = input.lifetime;

  const res = await call("POST", "/sessions", { body });
  const session = res.body as unknown as Session;
  capture(minted([session]));
  return session;
}

export async function show(id: string, bearer: string): Promise<Session> {
  const res = await call("GET", `/sessions/${encodeURIComponent(id)}`, { bearer });
  return res.body as unknown as Session;
}

export interface Delivery {
  id: string;
  delivered?: boolean;
  parked_on?: string;
  suspicious_dialog?: boolean;
}

export async function prompt(id: string, text: string, bearer: string): Promise<Delivery> {
  if (!text.trim()) {
    throw new UsageError("prompt text is empty", 'crswd-axi prompt <id> "what to type"');
  }
  const res = await call("POST", `/sessions/${encodeURIComponent(id)}/prompt`, {
    body: { text },
    bearer,
  });
  return res.body as unknown as Delivery;
}

export interface Capture {
  id: string;
  captured_at?: string;
  text?: string;
}

export async function output(id: string, bearer: string): Promise<Capture> {
  const res = await call("GET", `/sessions/${encodeURIComponent(id)}/output`, { bearer });
  return res.body as unknown as Capture;
}

export async function close(id: string, bearer: string): Promise<{ id: string; destroyed?: boolean }> {
  const res = await call("DELETE", `/sessions/${encodeURIComponent(id)}`, { bearer });
  return res.body as unknown as { id: string; destroyed?: boolean };
}
