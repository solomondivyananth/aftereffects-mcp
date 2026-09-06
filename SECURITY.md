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
