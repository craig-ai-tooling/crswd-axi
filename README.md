# crswd-axi

An [AXI](https://axi.md) CLI over [crswd](https://github.com/craig-ai-tooling/claude-remote-session-webhook)'s
six signed session routes.

```sh
crswd-axi                                   # live sessions
crswd-axi list --fields id,name,work_dir
crswd-axi show <id>
crswd-axi create <name> --work-dir /abs/path
crswd-axi prompt <id> "run the tests"
crswd-axi output <id> --tail 40
crswd-axi close <id>
crswd-axi doctor
```

Every command takes `--help`. Output is TOON on stdout, errors included.
Exit codes: `0` success, `1` error, `2` usage error, `5` usable with an
optional connector absent.

## What it replaces

crswd's shipped client is `deploy/crswd-api`: 73 lines of bash taking
`METHOD PATH [BODY] [BEARER]` positionally. Every caller re-derives the HMAC
signing scheme and hand-builds JSON bodies from memory of
`internal/httpapi/server.go`. Over 30 days of one box's transcripts that came
to 364 raw `curl` calls at crswd, a quarter of them failing.

## The two things it does that a hand-rolled call does not

**It writes down the bearer.** crswd puts a session's plaintext token in
exactly two responses in that session's whole life: the `create` reply, and the
first `list` after the daemon restarts and re-adopts the session. There is no
re-issue path — `Manager.ClaimPending`: *"Each token is returned by exactly one
call; a second asks about nothing."* A caller that lists sessions and parses
`id` and `name` while dropping `token` burns that credential permanently, and
the session can then be neither prompted nor closed by anyone until it expires.
That has happened: 12 of 13 live sessions, uncloseable, measured on 9/1/26.

`crswd-axi list` captures before it renders, on every path, including the one
`doctor` probes with. `show`, `prompt`, `output` and `close` look the bearer up
themselves; you never pass one.

**It exits non-zero when the answer is a failure.** crswd answers some refusals
with HTTP 200 and an `error` field. The bash client prints the body and exits 0
regardless, so `{"error":"too many requests"}` reached callers as a success —
two of them carry a comment saying exactly that and re-check the body by hand.
Here a body with an `error` field is an error whatever the status line says,
and the suggestion names the next move:

```
error: crswd has no such session for this caller: DELETE /sessions/38aa…
suggestion: crswd answers one 404 for all of: unknown id, another caller's
  session, a wrong or expired bearer, and a session already destroyed.
  Run `crswd-axi list` to see what exists
```

## Install

Pin to a tagged release, not `main` — an unpinned ref is a different build on
every install and the one this repo already shipped once by accident (see
`v0.1.0`'s "no dist" fix). `git ls-remote --tags` or the
[releases page](https://github.com/craig-ai-tooling/crswd-axi/releases) has
the current tag.

```sh
npm install --prefix ~/.local/share/axi-tools github:craig-ai-tooling/crswd-axi#v0.1.0
ln -sf ~/.local/share/axi-tools/node_modules/crswd-axi/bin/crswd-axi.js ~/.local/bin/crswd-axi
```

`.github/workflows/release.yml` also attaches a prebuilt tarball
(`crswd-axi-<version>.tgz`, `dist/` included) to each tagged release — useful
where `npm install` from a git ref is undesirable, e.g. `gh release download
v0.1.0 -R craig-ai-tooling/crswd-axi` followed by `npm install --prefix
~/.local/share/axi-tools ./crswd-axi-0.1.0.tgz`.

Then `crswd-axi doctor`.

`crswd-axi setup hooks` installs a SessionStart hook that shows an agent the
live session list before it reaches for `curl`. It writes to your agent's own
config, so it is its own command and never a side effect; `setup status`
reports and writes nothing.

## Settings

| name | default | what |
|---|---|---|
| `CRSWD_HOST` | `http://127.0.0.1:8765` | the daemon to sign for |
| `CRSWD_OP_ITEM` | `op://Lobster/crswd` | 1Password item holding the credentials |
| `CRSWD_SHARED_SECRET` | — | the HMAC secret directly, instead of 1Password |
| `CRSWD_ACCESS_CLIENT_ID` / `_SECRET` | — | Cloudflare Access service token, for a tunnelled host |
| `CRSWD_ACCESS` | — | `off` declares there is no Access policy in front |
| `CRSWD_NO_OP` | — | `1` never shells out to `op` |
| `CRSWD_AXI_TOKENS` | `~/.local/state/crswd-axi/tokens.jsonl` | bearer store; `:`-separated for more than one |
| `CRSWD_TIMEOUT_MS` | `30000` | per-call timeout |

### Sharing the bearer store

`CRSWD_AXI_TOKENS` takes a list because a box may already have a tool holding
these tokens, and two independent listers racing for the one response that
carries them is how a credential gets lost. Reads merge across every file in
the list and writes go to all of them, so pointing crswd-axi at an existing
store makes the two agree instead of compete.

The store is append-only JSONL, read newest-last. A re-mint changes the token
and nothing else, so each new row is cloned from that session's most recent row
with the token swapped — any field another writer put there is carried forward
untouched. crswd-axi never blanks a field it does not understand.

## Cloudflare Access is not the API's door

`CF-Access-Client-Id` / `CF-Access-Client-Secret` are read by Cloudflare's edge,
never by crswd: the six signed routes go through `s.authenticate` alone. They
are needed exactly when a Tunnel sits in front of the host, so `doctor` reports
them as `n/a` on loopback rather than as a gap.

## Development

```sh
npm install && npm run build
npx vitest run
npm run skill:gen                       # regenerate skills/crswd-axi/SKILL.md
npx -y axi-axi validate "node bin/crswd-axi.js" --dir .
```

CI runs all four. The validator is the compliance gate: it spawns the real
binary and inspects stdout and exit codes, so it cannot be satisfied by a
source string.

## Licence

MIT.
