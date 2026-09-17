# AGENTS.md

Primary context file for any agent working in this repo. Read this first.

`crswd-axi` is an AXI CLI over crswd's six signed session routes. What it is
and how to run it: [README.md](README.md). What follows is only what an agent
changing it needs.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Build | `npm run build` |
| Test | `npx vitest run` |
| Regenerate SKILL.md | `npm run skill:gen` |
| AXI compliance gate | `npx -y axi-axi validate "node bin/crswd-axi.js" --dir .` |

A change is not done until all five pass. CI runs build, test, `skill:check`
and the validator; nothing else gates a merge.

## The rule that matters more than any other

**Every path that lists sessions must capture the bearer before it renders.**

crswd hands a session's plaintext token over exactly twice in that session's
life — the `create` reply, and the one `GET /sessions` that adopts it after a
daemon restart — and there is no re-issue path. A lister that drops `token`
destroys that credential permanently and leaves the session undrivable by
anyone until it expires. The reasoning, with the measurement behind it, is at
the head of `src/crswd/tokens.ts`.

So: `src/crswd/sessions.ts#list()` is the only way anything here asks crswd who
is live, and it captures unconditionally. Do not add a second lister, do not
add a `--no-capture` flag, and do not call `client.call("GET", "/sessions")`
from anywhere else.

## The second rule

**A source that cannot be reached is reported, never rendered as empty.**

"The gateway did not answer" arriving as "there is nothing there" is the
failure this tool exists to not have. Concretely:

- A response body carrying an `error` field is an error whatever the HTTP
  status says — crswd answers some refusals 200-with-an-error-body.
- `doctor` exits non-zero when a required connector is down. A probe that
  cannot run reports `down`; it never reports `ok` by omission.
- The home view is the one command that must still exit 0 when crswd is
  unreachable, because a SessionStart hook runs it. It says `UNAVAILABLE` and
  names why. `test/cli.test.ts` pins both halves.

## Layout

| Path | What lives here |
|---|---|
| `src/cli/` | Router, strict flag parser, help renderer. Copied verbatim from `axi-axi new`; prefer fixing upstream to diverging |
| `src/output/` | TOON emitters, structured errors, truncation. Same provenance |
| `src/crswd/` | Everything crswd-specific: `config`, `sign`, `client`, `tokens`, `sessions` |
| `src/commands/` | One file per verb. Each exports a `CommandModule` whose `spec` drives both `--help` and the parser |
| `src/skill/content.ts` | Single source for the root help AND the generated `skills/crswd-axi/SKILL.md` |
| `test/fake-crswd.ts` | A crswd that verifies signatures the way the real one does |

## Tests

Table-driven where it helps, no network beyond `127.0.0.1`, and **no test may
touch the real daemon, the real 1Password, or the real token store**.
`test/cli.test.ts` seals the environment (`CRSWD_HOST` at a refused port,
`CRSWD_NO_OP=1`); the unit tests point at `test/fake-crswd.ts` and a temp store.

The fake verifies the signature rather than accepting it. A test against a
server that takes anything proves the client sends something, not that it sends
something crswd would accept — a client that signed the decoded path would pass
such a test and fail in production.

A new test must be able to fail. If it passes both before and after the change
it is pinning nothing.

## Adding a command

1. A `CommandModule` in `src/commands/`, with `args`, `flags` and `examples`
   filled in — the parser, `--help` and the validator all read that one spec.
2. Register it in `src/index.ts`.
3. Add it to `COMMANDS` in `src/skill/content.ts`, then `npm run skill:gen`.
4. Add it to the `COMMANDS` array in `test/cli.test.ts`, which asserts every
   command answers `--help` with exit 0 and refuses an unknown flag with exit 2.

## Never

- Print a token. `create` says the bearer was recorded, not what it is; stdout
  here is read by agents whose transcripts are kept.
- Name a secret's value in an error, a log line or `doctor` output. Present or
  absent, and where it was looked for, is the whole reportable fact.
- Retry more than once on a 401. One retry clears a same-second signature
  collision; a loop turns a wrong secret into a flood.
