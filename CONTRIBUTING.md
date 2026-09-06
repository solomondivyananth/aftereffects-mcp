# Contributing

## Getting set up

```bash
./install.sh          # symlink install — edits in this repo go live
```

Relaunch After Effects, open **Window ▸ Extensions ▸ AE MCP Bridge**.

The panel has a **↻** button that re-reads `bridge.jsx` and `main.js` from disk,
so most iteration doesn't need an AE restart. You *do* need a restart when the
extension ID or `manifest.xml` changes, because CEP only scans the extensions
folder at launch.

If you installed with `--copy`, run `./sync.sh` before reloading.

## Debugging

The panel is Chromium. `.debug` exposes it on port 8088 — open
`http://localhost:8088` in a browser for full devtools against the panel.

ExtendScript errors surface in the panel's call log and in tool responses.
`bridge.jsx` wraps every dispatch in try/catch and returns the message and line
number rather than the useless `EvalScript error.`

## Constraints worth knowing before you write code

- **`bridge.jsx` is ES3.** No `let`, `const`, arrow functions, `Array.indexOf`,
  or native `JSON`. There's a JSON polyfill at the top of the file. This is the
  ExtendScript engine's limit, not a style choice.
- **`main.js` runs in CEP's Chromium** with Node enabled — modern JS is fine
  there, and `require` works.
- **`mcp/ae-mcp.js` has zero dependencies and should stay that way.** It has to
  run wherever an MCP client can spawn Node, with no install step.
- **Don't weaken the request path.** The token check, the `Origin`/`Referer`
  rejection and the `Content-Type` requirement each close a different route to
  remote code execution. See [SECURITY.md](SECURITY.md).
- **Don't add a tool that lifts the sandbox guard.** The guard is only meaningful
  because a model cannot turn it off.

## Adding a tool

1. Add the function to `bridge.jsx` and a `case` in `__aeDispatch`.
2. If it mutates the project, add its name to `__AE_WRITE_FNS` — that string is
   what the guard reads. A write op missing from that list is unguarded.
3. Add the tool definition in `mcp/ae-mcp.js` with a real `inputSchema`.
4. Write the description for a model, not a human: say when to use it and what
   it returns. Descriptions are the whole interface.

## Testing

There's no suite yet — this is the most valuable thing anyone could contribute.
Until then, verify by hand against a scratch project, never a real one, and
check the panel's call log for refusals.
