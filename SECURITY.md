# Security

## What this software can do

The panel runs an HTTP server on `127.0.0.1` that can execute **arbitrary
ExtendScript inside After Effects**, which can read and write files and launch
processes. Treat the bridge as equivalent to a local shell.

## How it is protected

- **Loopback only.** The server binds `127.0.0.1` and is never exposed on a network
  interface.
- **Shared-secret auth.** A 256-bit token is generated on first run and stored in
  `~/.ae-mcp-bridge.json` (mode 0600). Every request must carry it in the
  `X-AE-Bridge-Token` header, compared in constant time.
- **Browser requests are refused.** Any request carrying an `Origin` or `Referer`
  header is rejected. A local tool client never sends these; a web page always
  does on a cross-site request.
- **JSON only.** `Content-Type` must be `application/json`, which forces a CORS
  preflight for cross-origin callers — and the preflight is not answered.
- **Sandbox guard.** Write operations are refused unless the open project matches
  the designated sandbox. Only a human can lift this, from the panel UI; no tool
  can unlock it.

- **Raw scripting switch.** `ae_run_jsx` and `ae_menu_command` can be turned off
  in the panel. With the guard on, the panel checks the open project before and
  after each raw call and flags any switch loudly.

### What the sandbox guard does not cover

The guard stops an AI agent that is using **only the MCP tools** in this project:
no tool can disable it, so a model cannot unlock itself no matter what it is
asked or told.

It also cannot see *inside* `ae_run_jsx` or `ae_menu_command`: the guard checks
which project is open before a write, but raw ExtendScript can open or close
projects during the call. The panel detects that afterwards and warns, but it
cannot prevent it. If that matters, switch raw scripting off in the panel.

It does **not** stop an agent that also has general control of your desktop. An
agent with macOS Accessibility permissions, shell access, or the ability to edit
`~/.ae-mcp-bridge.json` can turn the guard off the same way you would. Treat the
guard as protection against a tool-scoped agent overstepping, not as a sandbox
against an adversary who already controls the machine.

`GET /alive` is the one unauthenticated endpoint. It returns a liveness flag and
version only, and reveals nothing about the machine or the open project.

## Why the token matters

Without it, any website loaded in any browser on the machine could POST to
`127.0.0.1:7788` and run code in After Effects. `Content-Type: text/plain` makes
such a request a CORS "simple request", so no preflight is sent and the browser
delivers it. The attacker cannot read the response, but the side effect has
already happened. Do not remove the token, the Origin check, or the Content-Type
check — each closes a different path to the same hole.

## Reporting

Please open a private security advisory on the repository rather than a public
issue.
