# Origamio

Yet another origami simulator: fold a square sheet of paper along arbitrary
lines in the browser, watch the layers stack up, and unfold it at any time to
inspect the crease pattern and count the resulting faces.

**Try it:** <https://origamio.hannesgao.workers.dev/>

Origamio is a pure front-end application (Vite + TypeScript, no framework, no
runtime dependencies). Both views are rendered as SVG from a small, immutable
geometric model, so every fold is exact: no meshes, no physics, just
reflections and convex polygon clipping.

## Features

- **Fold along any line.** Drag on the folded sheet to draw a fold line, then
  click the side that should flip over. The endpoints snap to the corners,
  edge midpoints and edges of the folded sheet, so a fold "corner to corner"
  or "edge to the middle" is exact; hold Alt to draw freely.
- **Fold all layers or only the top _k_.** Choose between folding the whole
  stack or just the top few layers before you click.
- **Live unfolded view.** The right panel always shows the sheet flattened out
  again, with every crease drawn in red and a legend for front, back and
  crease colours.
- **Layer-aware colouring.** Facets are translucent, so a region gets darker
  with every layer stacked on top of it. Facets showing their back side use a
  darker base colour.
- **Flip animation.** The moving flap rotates around the fold line for about
  0.8 s, switching to its back colour as it passes the vertical.
- **Statistics.** Number of folds, maximum number of layers at any point,
  number of faces in the unfolded sheet, and the layer count under the cursor.
- **Undo, reset and presets.** Fold in half three times, or fold in half twice
  and then fold one of three kinds of corner: the loose corner where the four
  sheet corners stack, the corner where both folded edges meet, and a corner
  with a single folded edge.
- **Any sheet shape and colour.** The Paper panel offers square, A series,
  4:3, 3:2 and 16:9 sheets, a custom width and height, a rotate button, six
  face-colour pairs and two colour pickers. Changing the size rewinds to the
  flat sheet and keeps every step on the timeline; changing colours is
  instant. Size and colours are part of every exported file and are restored
  on import.
- **A crane.** The _Crane_ preset plays the classic sequence in 21 folds:
  pre-crease the diagonals, fold the preliminary base, petal fold both sides
  into the bird base, narrow the points, close the model along its centre
  line, reverse fold the neck, the tail and the head, and fold the wings
  down. The result is the flat crane of the diagrams, lying on its side,
  before the wings are spread.
- **Layer view.** A third card shows the folded stack obliquely with every
  layer lifted a little, so the stacking order is visible at a glance; a slider
  sets the gap. While a flap is folding it rises out of the plane. Pointing at
  a facet in any view outlines the same facet in the other two, and pointing
  at the folded sheet outlines every facet under the cursor.
- **Light and dark themes.** The interface follows the operating system's
  colour scheme.
- **An editable timeline.** Every clip can be renamed (double-click or F2),
  dragged to another position, duplicated, deleted (Delete) or cut off with
  everything after it, from a right-click menu. A fold made by hand is
  inserted at the playhead and the later steps stay. Edits are undone and
  redone with Ctrl+Z and Ctrl+Shift+Z, independently of the playhead. Because
  each step's line is written in the coordinates of the sheet as it is at
  that moment, a step that no longer moves anything after an edit is marked
  with red hatching so it can be fixed.
- **A step inspector.** The Step panel on the rail edits the selected step:
  its name, which layers move (all, top _n_, bottom _n_), where the moved
  paper lands (on top, underneath, inside), which side moves, the two points
  of the fold line, and any region or window limit a preset step carries.
  _Redraw the line_ rewinds to just before the step and takes the next line
  you draw on the folded sheet as its new line.
- **Timeline, replay, import and export.** Every fold, whether made by hand
  or by a preset, lands on an editing-style timeline under the views: a ruler,
  one clip per step and a playhead you can drag. Step back and forward (also
  with the arrow keys), play and pause at any step, choose the playback
  speed, click a clip or scrub to jump. Presets only load their steps; you
  decide whether to step through them or play them. Undone steps stay on the
  timeline until a new fold by hand replaces them. The whole timeline can be
  saved as a JSON file and loaded again later; the presets ship in the same
  format.
- **Three layouts.** The header switches between _Folded large_ (the
  default: the folded view fills most of the workspace and a second card
  beside it shows either the crease pattern or the layers, chosen with a tab
  strip in its head), _Side by side_ (all three views in a row) and _Focus_
  (one view at a time, chosen with a tab strip over the workspace). The folded
  canvas is as big as its card allows, whatever the window's aspect; the other
  two canvases stay square. All of these choices are remembered in the
  browser.
- **Made for wide screens.** Header, rail and status bar are fixed and the views
  are sized to the remaining space, so nothing scrolls on a 16:9 display.
  Windows narrower than 1340 px show one view at a time behind Folded /
  Unfolded / Layers tabs and float the panels over the workspace; on phones
  the playback controls sit at the bottom edge.

## Using the simulator

The page is a workbench that fills the window and never scrolls as a whole: a
fixed header with the sequence name (edit it in place) and the layout switch,
an icon rail on the left whose buttons open the Library (presets, in groups),
Paper (size and colours), Step (the selected step's parameters), File (name,
import, export, new) and Shortcuts panels, the workspace with the three view
cards and the timeline card under them, and a status bar along the bottom
that shows the sheet with its two colours, the position on the timeline and
the latest message (what was loaded, what a fold did, why a file was
rejected), with the credits and version on its right. Every view card has
the same anatomy: a head with the title and one row of tools, the canvas, and
two lines underneath (status and statistics for the folded sheet; legend and
crease count for the crease pattern; a note and the gap slider for the layer
view), so the cards and their canvases are the same height. The views size
themselves to the space that is left. Everything you operate on is in the
Folded card: the drag tool, the layer selection, zoom and the status line.

1. **Draw a fold line.** Press on the folded sheet, drag, and release. A dashed
   blue line shows where the fold will go; drags shorter than 2 % of the sheet
   are ignored. While you draw, the corners and edge midpoints of the folded
   sheet show as dots and the endpoint snaps to the nearest one (or onto an
   edge) within a few pixels; a ring marks the snap and the status line names
   it. The _Snap_ button turns this off, and Alt bypasses it for one drag. The
   fold goes onto the timeline at the playhead.
2. **Choose the side.** Move the pointer over either side of the line; the side
   that would flip is shaded. Click to fold it over. Press Esc to discard the
   line instead.
3. **Pick how many layers move.** The _All / Top n_ control in the Folded
   toolbar applies to the next fold: _All_ folds the whole stack, _Top n_
   folds only the facets that have fewer than _n_ distinct layers above them.
4. **Watch the result.** The status line under the folded sheet tells you
   which step you are in, and the statistics beneath it (folds, maximum
   layers, facets, layers under the cursor) update after every fold.
5. **Choose the paper.** The Paper panel (second button on the rail) shows
   the current sheet and lets you pick a shape or type a width and height;
   the longer side is 1 by convention. Presets are folded from a square, so
   loading one switches the sheet back and says so in the status line.
6. **Try a preset.** The Library panel (first button on the rail) lists the
   presets; clicking one loads its steps onto the timeline from a flat sheet,
   where you step through or play them. Esc or the × closes the panel.
7. **Replay and share.** The Timeline card under the views holds the transport buttons
   (start, one step back, play or pause, one step forward, end) and the speed
   menu (a quarter speed up to four times); the position and the latest
   message are in the status bar at the bottom of the window. Its body shows
   the steps as clips on a numbered track: filled clips are applied,
   dashed ones are still to come, the red playhead sits after the last
   applied step (it slides along while a step animates), and red hatching
   marks a step that moves nothing where it now sits. Playing stops at the end
   of the current step when you press pause, P or Esc. Clicking a clip selects
   it and jumps to the end of that step; dragging on the ruler scrubs from
   step to step; dragging a clip moves it; double-clicking renames it; the
   right-click menu renames, duplicates, moves and deletes. The _Track_
   button hides the track; the choice and the speed are remembered. The File
   panel on the rail names the sequence, exports the timeline as JSON,
   imports such a file onto a fresh sheet and clears everything with _New_.
8. **Read the stack.** The Layers card draws the folded sheet from the front
   with each layer lifted by the _Gap_ slider; set it to zero for a plain side
   view. Move the pointer over a facet in the Unfolded or Layers view to see
   where it sits in the folded sheet, or over the folded sheet to see all
   facets stacked under the cursor.
9. **Look closer.** The folded sheet gets small quickly, so the Folded card has
   its own navigation: _Fit_ frames the folded sheet, _Full_ shows the whole
   square again, the mouse wheel zooms around the pointer, and the _Move_ tool
   (or holding Space, or the middle mouse button) lets you drag the view. On a
   touch screen, pinch to zoom and pan with two fingers. Zoom and position are
   kept across folds and undo; Reset returns to the full view.

Keyboard shortcuts:

| Key                     | Action                                          |
| ----------------------- | ----------------------------------------------- |
| Ctrl+Z (Cmd+Z on macOS) | Undo the last edit of the timeline              |
| Ctrl+Shift+Z / Ctrl+Y   | Redo an edit                                    |
| Delete                  | Delete the selected step                        |
| F2                      | Rename the selected step                        |
| Esc                     | Cancel the fold line you are drawing or placing |
| F                       | Fit the folded sheet into view                  |
| 0                       | Show the whole sheet                            |
| Space (held)            | Drag to pan instead of drawing a fold line      |
| → / ←                   | One step forward or back on the timeline        |
| P                       | Play or pause the remaining steps               |
| Home / End              | Jump to the flat sheet or to the last step      |

## Getting started

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev        # start the dev server
npm run build      # static site in dist/
npm run preview    # serve the production build locally
```

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so the
contents of `dist/` can be served from any static host or sub-directory
without configuration.

### Quality checks

```sh
npm run lint          # ESLint (typescript-eslint strict + stylistic)
npm run format:check  # Prettier
npm run typecheck     # tsc --noEmit with strict options
npm test              # Vitest specs in tests/
npm run build
```

`npm run format` rewrites files in place. The `ci` workflow runs exactly these
commands on every pull request and on every push to `main`.

### Deployment

The site is served from Cloudflare Workers as static assets; `wrangler.jsonc`
names the Worker (`origamio`) and points it at `dist/`; the site is live at
<https://origamio.hannesgao.workers.dev/>. The `deploy` workflow
builds and deploys every push to `main` through the Wrangler CLI, using two
repository secrets: `CLOUDFLARE_API_TOKEN` (an API token with the _Edit
Cloudflare Workers_ template) and `CLOUDFLARE_ACCOUNT_ID`. To deploy from a
machine instead:

```sh
npx wrangler login   # once; opens the browser
npm run deploy       # build, then upload dist/ as the Worker's assets
```

`npx wrangler deploy --dry-run` checks the configuration without uploading.

### Screenshots

Browser screenshots for pull requests and visual checks go through one helper,
which drives a headless browser with Playwright:

```sh
npm run dev                                   # in one terminal
npm run shot -- --out shots                    # one screenshot of the page
npm run shot -- --out shots --scenario scripts/scenarios/preset.mjs
```

A scenario is an ES module whose default export gets the Playwright page and a
`shot(name)` helper; `scripts/scenarios/preset.mjs` loads a preset and captures
the views. The helper prefers Playwright's own Chromium (`npx playwright-core
install chromium`, plus `sudo npx playwright-core install-deps chromium` once on
Linux or WSL) and falls back to the Chrome installed on Windows when run from
WSL, using a fresh temporary profile for every run that it closes and deletes
afterwards. It never ends browser processes by name. `shots/` is ignored by git.

## Data model

The sheet is a unit square in the coordinate system of the **unfolded** paper.
It is represented as a set of _facets_ (`src/paper.ts`):

| Field       | Meaning                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `poly`      | A convex polygon in unfolded-sheet coordinates. Facets never overlap in this space; together they tile the sheet. |
| `transform` | A 2D affine transform (a product of reflections) that maps unfolded coordinates to the current folded position.   |
| `z`         | The layer index. Larger values are closer to the viewer.                                                          |

A fold `fold(state, line, side, layers)` works as follows:

1. `line` is given in the **folded** coordinate system, `side` says which
   half-plane flips over, and `layers` is `all`, "the top _k_ layers" or "the
   bottom _k_ layers". A facet belongs to the top _k_ layers when fewer than
   _k_ distinct layers lie above it at its current position. The selection can
   be narrowed further to facets inside a convex `region` of the unfolded
   sheet or a convex `window` of the folded sheet; scripted sequences use
   this to fold one named part of the paper.
2. Each selected facet is cut by the line. The line is pulled back into the
   facet's own coordinates through the inverse transform, and the polygon is
   clipped into the part that stays and the part that moves.
3. The moving part gets the reflection across the fold line composed onto its
   `transform` (`reflection ∘ transform`). The staying part keeps its transform.
   Both keep their polygons in unfolded coordinates.
4. The moved facets are placed according to `placement`: on `top` of the
   stack with their layer order reversed, exactly as a real flap would land;
   at the `bottom`, the mirror image of that, for a fold made on the back of
   the model; or `inside`, between the layers they were cut from, which is
   what an inside reverse fold does to a point.
5. Every facet that was actually cut records a crease: the chord of the fold
   line inside the facet, stored in unfolded coordinates.

Because every facet keeps its unfolded polygon, the unfolded view is simply
every `poly` plus every crease segment. The number of faces is the number of
facets, and the maximum number of layers is the depth of the deepest cell in
the arrangement of all facet edges, found by probing just inside every
arrangement vertex.

Facet transforms are compositions of reflections, so their determinant is
−1 whenever the facet currently shows its back side; the renderer uses that to
pick the face colour.

`FoldHistory` keeps the list of states so that undo is a pop; states are never
mutated, so a fold that moves nothing is rejected without changing history.

### Sequence files

Presets live in `presets/*.json` and anything you fold can be exported to the
same format: a project file that holds the sheet and every step. A file is an
object with `format` `"origamio-sequence"`, `version` `1`, a `name`, an
optional `description`, an optional `paper` and a list of `steps`. `paper`
holds `width` and `height` in sheet units (sides between 0 and 10) and the
face colours `front` and `back` as hex colours; a missing `paper` means the
unit square in the default orange and brown, and missing colours default the
same way.
Every step is one call of `fold` on the sheet as it is at that moment:

```json
{
  "line": [
    [0.5, 0.207107],
    [0.207107, 0.5]
  ],
  "side": 1,
  "layers": { "top": 1 },
  "region": [
    [0, 0.5],
    [0.5, 0.5],
    [0.5, 1],
    [0, 1]
  ],
  "placement": "inside",
  "label": "Petal fold"
}
```

| Field       | Meaning                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `line`      | Two points on the fold line, in the **folded** coordinates of that step (unit sheet, origin bottom left). |
| `side`      | `1` or `-1`: the half-plane to the left or to the right of the directed line flips over.                  |
| `layers`    | `"all"` (default), `{ "top": k }` or `{ "bottom": k }`.                                                   |
| `region`    | Optional convex polygon in **unfolded** coordinates; only facets inside it take part.                     |
| `window`    | Optional convex polygon in **folded** coordinates; only facets inside it take part.                       |
| `placement` | `"top"` (default), `"bottom"` or `"inside"`, see above.                                                   |
| `label`     | Optional name shown on the timeline.                                                                      |

`src/sequence.ts` parses and validates files (errors name the offending field)
and serialises them with points kept on one line. The preset files are
generated from the geometry in `src/presets.ts`: `npm run presets:write`
rewrites them and `npm test` fails when they are out of date.

### Code layout

| File              | Responsibility                                                                   |
| ----------------- | -------------------------------------------------------------------------------- |
| `index.html`      | Page shell, favicon and meta tags; mounts the app on `#app`                      |
| `src/main.ts`     | Entry point: loads the stylesheet and creates the app                            |
| `src/geometry.ts` | Vectors, lines, affine transforms, reflections, convex clipping and intersection |
| `src/paper.ts`    | Facet model, `fold`, layer selection, statistics, undo history                   |
| `src/render.ts`   | SVG markup for the three views, the fold animation and the folded-view camera    |
| `src/sequence.ts` | The JSON sequence format: parse, validate, serialise                             |
| `src/presets.ts`  | Geometry of the shipped sequences, including the crane; source of `presets/`     |
| `src/library.ts`  | Loads `presets/*.json` for the app                                               |
| `src/ui.ts`       | Page layout, toolbar, pointer interaction, animation loop, shortcuts             |
| `src/style.css`   | Theme tokens (light and dark), layout, controls and SVG styling                  |
| `presets/`        | The shipped sequences as JSON, generated from `src/presets.ts`                   |
| `tests/`          | Vitest specs for geometry, paper, camera, layer view, sequences and the presets  |

## Contributing

`main` is protected by the `protect-main` ruleset: changes land only through a
pull request whose `ci` and `pr-hygiene` checks pass on a branch that is up to
date with `main`, merged with squash, and the history stays linear (no force
pushes, no branch deletion).

Conventions that the checks enforce:

- **Branch and merge.** Work on a feature branch, open a pull request against
  `main`, and squash merge. The squash commit takes the pull request title and
  description, and the branch is deleted automatically after the merge.
- **Conventional Commits.** Commit messages and pull request titles look like
  `type(scope): summary` (`feat`, `fix`, `docs`, `refactor`, `test`, `ci`,
  `chore`, …), written in the imperative and at most 72 characters.
- **Pull request template.** `.github/pull_request_template.md` asks for what,
  why, how to test, screenshots for UI changes and a checklist.
- **Hygiene check.** The `pr-hygiene` workflow rejects pull requests whose
  title, description, commit messages or file list contain any of the patterns
  stored in the repository variable `FORBIDDEN_PATTERNS`, such as tool
  attribution footers and trailers. The repository also carries no
  configuration files for editor assistants or AI tools.

### Releasing

Every merge to `main` deploys; a release marks a version worth naming. The
`release` workflow enforces the only rule that matters (the tag must equal
`v` + the version in `package.json`) and attaches the built site to the
release as `origamio-<version>.zip`, for anyone who wants to host it
themselves.

1. Open a pull request that bumps `version` in `package.json` (the status bar
   shows it) and merge it.
2. On GitHub, draft a new release: create the tag `v<version>` on `main`, write
   the notes (what changed, known limitations, anything about the sequence
   file format) and publish.
3. Publishing runs the `release` workflow, which builds from the tag and
   uploads the zip. It can also be run by hand from the Actions tab for an
   existing tag.

Sequence files are versioned separately from the application: format
version 1 is stable, and any later version will read it.

## License

MIT. Copyright (c) 2026 Hannes Gao. See [LICENSE](LICENSE).
