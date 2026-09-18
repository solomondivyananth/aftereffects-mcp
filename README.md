# AE MCP Bridge: an After Effects MCP server for AI agents

<a href="https://solomondivyananth.github.io/aftereffects-mcp/"><img src="docs/assets/welcome.gif" alt="AE MCP Bridge: After Effects meets AI. Read every layer, see every frame, edit live. 46 tools plus skills, in your timeline." width="100%"></a>

<p align="center"><a href="https://solomondivyananth.github.io/aftereffects-mcp/"><b>Website</b></a> · <a href="docs/assets/welcome.mp4">Watch in HD</a> · <a href="#install">Install</a> · <a href="#tools">Tools</a></p>

**Let an AI actually work in After Effects — read the project, look at rendered
frames, and change keyframes, expressions and effects while the app is open.**

Not a code generator that hands you a `.jsx` to run. A live connection to the
running application: the model inspects your real comp, renders a real frame,
makes a real edit, then re-renders to check its own work.

```
MCP client ──stdio──► mcp/ae-mcp.js ──HTTP :7788──► CEP panel in AE ──evalScript──► AE DOM
```

Works with [Claude Code](https://claude.com/claude-code) or any client that
speaks the [Model Context Protocol](https://modelcontextprotocol.io). Nothing in
the bridge is client-specific.

MIT licensed · macOS · After Effects 2022+ · zero npm dependencies

> Not affiliated with or endorsed by Adobe or Anthropic.

---

## What this makes possible

**Read a project you didn't build.** Ask what's animating in a 40-layer comp and
get an answer grounded in the actual property tree — keyframe times, ease
influences, expression source, effect parameters — rather than a guess from
layer names.

**Let the model see.** `saveFrameToPng` renders come back as images. The model
looks at the frame instead of reasoning blind about coordinates. Ask "is the
logo colliding with the lower third at 4 seconds?" and it can check.

**Edit with a real undo story.** Every call runs inside one
`beginUndoGroup`/`endUndoGroup`. Anything the model does is a single ⌘Z. There
is no half-applied state to clean up.

**Judge motion, not just numbers.** `ae_review_motion` samples a time range,
stitches an MP4, and returns a contact sheet — so timing and easing can be
evaluated as motion rather than as keyframe values that merely look correct.

**Build, not just tweak.** Create projects and comps, import footage, add and
animate layers, precompose, duplicate a master into 9×16 / 1×1 / 16×9, and queue
a background `aerender` job that doesn't freeze the app.

### Things it is genuinely good at

- Auditing a comp: what animates, where, driven by what
- Motion graphics automation — applying one consistent change across many layers,
  many comps, or a whole campaign of format variants
- Format variants from a finished master
- Expression authoring, with After Effects validating the syntax on write
- Catching continuity mistakes by looking at frames, not just properties

### Things it is not good at

- Taste. It can match an existing ease curve; it cannot tell you the ad is boring.
- Anything unscriptable — Roto Brush, Content-Aware Fill, mocha tracking, puppet
  pins. The ExtendScript DOM barely reaches these.
- Real-time playback. It sees sampled frames, never a live preview.

---

## Install

Requires **After Effects 2022 (22.0)+**, **Node.js 18+**, and macOS.
`ffmpeg` is optional but recommended — it powers motion review.

**From npm:**

```bash
npx aftereffects-mcp-install       # installs the After Effects panel
claude mcp add after-effects -- npx -y aftereffects-mcp
```

**From source** (do this if you want to hack on it):

```bash
git clone https://github.com/solomondivyananth/aftereffects-mcp.git
cd aftereffects-mcp
./install.sh              # symlink the panel, enable unsigned extensions
```

Then **relaunch After Effects** (`PlayerDebugMode` is read at launch) and open
**Window ▸ Extensions ▸ AE MCP Bridge**. A green dot and
`Listening on 127.0.0.1:7788` means it's ready.

| Flag | |
|---|---|
| `./install.sh` | symlink install — edits in the repo are live |
| `./install.sh --copy` | real copy, for when AE won't follow a symlink (use `./sync.sh` after edits) |
| `./install.sh --global` | also register the MCP server for every directory |

The included `.mcp.json` registers the server for this project directory, so
Claude Code picks the tools up automatically when run from the repo.

---

## Safety

This bridge executes arbitrary ExtendScript inside After Effects. That is
powerful and worth being deliberate about, so two independent protections ship
switched on.

### The sandbox guard

Reads and renders work on whatever project is open. **Writes are refused unless
the open project is the one you designated as the sandbox.** Only a human can
change that, from the panel UI — there is deliberately no tool that unlocks it,
so a model working through these tools cannot talk its way past the guard.

(It is not a sandbox against an agent that already controls your desktop — one
with shell or Accessibility access can untick the box just as you would. See
[SECURITY.md](SECURITY.md).)

Project-level operations (`ae_new_project`, `ae_open_project`) are refused
outright while the guard is on: they close the current project, and a path
comparison cannot make that safe. They also refuse to run unless you say
explicitly what happens to unsaved work — no silent data loss, and never a modal
dialog that would deadlock the bridge.

### Raw scripting switch

`ae_run_jsx` and `ae_menu_command` can do anything the app can, including
things the guard cannot see coming (a script can open another project). The
panel's **Allow raw ExtendScript and menu commands** switch turns both off; the
dedicated tools still work. With the guard on, the panel also checks whether a
raw call changed the open project and flags it loudly if it did.

### Network protection

The server binds loopback only and requires a 256-bit token, generated on first
run into `~/.ae-mcp-bridge.json` (mode `0600`). It also refuses any request
carrying an `Origin` or `Referer` header, and requires
`Content-Type: application/json`.

Those three checks close three different routes to the same hole. Without them,
**any web page you happened to be visiting could drive After Effects** — a
cross-origin POST with `Content-Type: text/plain` is a CORS "simple request", so
the browser sends it with no preflight. The attacker can't read the response,
but by then the code has already run. See [SECURITY.md](SECURITY.md).

---

## Tools

46 tools, named and shaped after After Effects itself.

**Read** — `ae_project_info` · `ae_comp_tree` · `ae_layer_detail` ·
`ae_find_animation` · `ae_selection` · `ae_list_items` · `ae_catalog`
(effects, presets, fonts, render templates)

**See & show** — `ae_render_frame` · `ae_review_motion` · `ae_goto`

**Animate** — `ae_set_property` · `ae_add_keyframes` · `ae_edit_keyframes` ·
`ae_set_expression` · `ae_clear_expression` · `ae_apply_effect` ·
`ae_apply_preset` · `ae_text` · `ae_markers` · `ae_masks` · `ae_shape` ·
`ae_add_property` · `ae_remove_property` · `ae_property_meta`

**Layers** — `ae_create_layer` · `ae_delete_layer` · `ae_set_layer_props` ·
`ae_layer_action` (duplicate, split, sequence, freeze frame, align, fit,
centre anchor, copy to comp)

**Project** — `ae_create_comp` · `ae_set_comp_settings` · `ae_duplicate_comp` ·
`ae_precompose` · `ae_import_file` · `ae_item_action` · `ae_delete_item` ·
`ae_new_project` · `ae_open_project` · `ae_save_project`

**Render** — `ae_render_video` · `ae_render_status` · `ae_render_cancel` ·
`ae_render_queue` (Render Queue panel and Media Encoder)

**Control** — `ae_undo` · `ae_batch` · `ae_menu_command` · `ae_run_jsx`

It speaks After Effects:

- **Time** as seconds (`2.5`), frames (`"75f"`) or timecode (`"0:00:02:15"`).
- **Easing** by name: `"easy"` is F9 Easy Ease, plus `"easy_in"`/`"easy_out"`.
- **Colours** as `"#ff8800"` or 0–1 / 0–255 arrays.
- **Many layers** in one call — `"selected"`, `"all"`, a list, or a name regex —
  as one undo step. `ae_batch` makes any sequence of calls one atomic step.
- **Every write is one Edit ▸ Undo step**, labelled "MCP: Set Position" and so on,
  and writes that change a value return it **before and after**.
- **Edits show up like hand edits**: the comp opens, the layers are selected,
  the playhead moves to the change. Switch it off in the panel.

Property paths are arrays: `["Transform","Position"]`,
`["Effects","Gaussian Blur","Blurriness"]`. Names or matchNames both work, and a
wrong segment returns the list of valid children instead of a bare failure — so
the model corrects itself rather than guessing.

The server also exposes the usage guide as the MCP prompt `after-effects`, and
the open project and current selection as resources (`ae://project`,
`ae://selection`).

---

## Design notes

Four things in the After Effects DOM will bite anyone building on it. They cost
real debugging time here, so they're written down.

**`elided` does not mean "ignore".** `PropertyBase.elided` marks a group that
isn't drawn as its own row in the timeline — `Animators`, `Selectors`,
`Properties` on a text layer are all elided. Their children are real, and are
frequently where the animation lives. Skipping them made a typewriter-animated
text layer report as "not animated", which produced a confidently wrong edit.
Flatten elided groups; never skip them.

**Transform is not where animation lives.** A layer can be fully animated with an
empty Transform group — text animators, shape trim paths, mask paths and effect
parameters all animate independently. `ae_comp_tree` returns `animatedProperties`
from a full-tree scan for exactly this reason.

**`saveFrameToPng` is asynchronous.** It returns roughly 450 ms before the PNG is
on disk, and the file appears at size 0 first. Both sides of the bridge poll each
frame until it exists and has stopped growing.

**`Folder.temp` is a per-app sandbox.** Anything After Effects writes there is
unreadable from outside the AE process. Frames go to `~/.ae-mcp-bridge/frames/`.

And one that isn't about the DOM: **stills lie about motion.** A frame sampled
mid-reveal is indistinguishable from a hard cut. That mistake is the reason
`ae_review_motion` exists.

---

## Layout

```
panel/           CEP extension loaded by After Effects
  CSXS/manifest.xml
  index.html     status, sandbox controls, live call log
  js/main.js     HTTP server, auth, guard enforcement, aerender jobs
  jsx/bridge.jsx everything touching the AE DOM (ExtendScript, ES3)
mcp/ae-mcp.js    MCP server — zero dependencies, stdio JSON-RPC
scripts/          check.js (npm test), live tests (npm run test:live), record-welcome.js
docs/            the website (GitHub Pages) and the welcome animation
install.sh       panel install + PlayerDebugMode
sync.sh          push local edits into a --copy install
skills/          ae-mcp-bridge skill — teaches a model how to use the tools
```

`bridge.jsx` is **ES3** — no `let`, `const`, arrow functions or native `JSON`
(there's a polyfill at the top). Responses over 100 KB spill to a temp file,
because `evalScript`'s return channel can't carry them.

---

## FAQ

**What is this actually for?**
Automating the repetitive half of motion graphics work — audits, bulk edits,
format variants, expression authoring — while you keep the creative decisions.
It is a scripting layer you talk to, not a replacement for a motion designer.

**Does this need an API key?**
No. The bridge holds no credentials. Your MCP client brings its own model.

**Does it work with clients other than Claude Code?**
Yes — it's a standard MCP stdio server. Nothing in it is Claude-specific.

**Will it edit my project without asking?**
Not unless you point the sandbox at that project, or switch the guard off. Reads
and renders always work; writes are gated.

**Can it render video?**
Yes, via `aerender` as a background job that doesn't block the app. It saves the
project first, because `aerender` reads the `.aep` from disk.

**Does it work on Windows?**
Not yet. The bridge and MCP server are portable, but the installer, the `sips`
image downscaling and the CEP paths are macOS-specific. PRs welcome.

**Why CEP and not UXP?**
After Effects 2026 ships UXP, but it hosts only Adobe's own plugins — there's no
public AE DOM API through it yet. CEP with ExtendScript is the only route to the
full object model today.

**Is the panel signed?**
No. `install.sh` enables `PlayerDebugMode`, which is how unsigned extensions load
during development. Distributing to non-developers would need ZXP signing.

---

## Status

**v0.1 — working, and honest about its edges.** The read, view and edit loop is
proven against real production projects. The authoring and render tools are
built and wired but have had less mileage. No tests or CI yet.

Contributions welcome, particularly Windows support, a test suite, and ZXP
packaging.

## License

[MIT](LICENSE)
