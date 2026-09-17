---
name: crswd-axi
description: "Drive crswd's signed session API: list, show, create, prompt, output, close"
---

# crswd-axi

Drive crswd's signed session API: list, show, create, prompt, output, close (built against AXI spec axi/1.0-2026-07).

```
commands[7]{command,summary}:
  list,"Every session, capturing any bearer crswd hands over"
  show,One session in full
  create,Start a session and record its bearer
  prompt,Type into a session and submit
  output,What the session's pane currently shows
  close,Destroy a session
  doctor,Probe every connector and name the fix for each gap
```

## The one thing to get right

crswd puts a session's bearer token in exactly two responses in that
session's whole life: the `create` reply, and the first `list` after the
daemon restarts and re-adopts it. There is no re-issue path. A caller that
lists sessions and drops the `token` field burns that credential
permanently, and the session can then be neither prompted nor closed by
anyone until it expires.

`crswd-axi list` captures before it renders, every time, so the bearer is
already on record by the time you read the table. Pass no tokens by hand;
`show`, `prompt`, `output` and `close` look them up.

## Commands

```sh
npx -y crswd-axi list
npx -y crswd-axi show <id>
npx -y crswd-axi create <name> --work-dir /absolute/path
npx -y crswd-axi prompt <id> "what to type"
npx -y crswd-axi output <id> --tail 40
npx -y crswd-axi close <id>
npx -y crswd-axi doctor
```

Every command supports `--help`. Exit codes: 0 success, 1 error, 2 usage
error, 5 usable with an optional connector absent. All output is TOON on
stdout, including errors.
