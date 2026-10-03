# Origamio

Yet another origami simulator: fold a square sheet of paper along arbitrary
lines in the browser, watch the layers stack up, and unfold it at any time to
inspect the crease pattern and count the resulting faces.

Origamio is a pure front-end application (Vite + TypeScript, no framework).
Both views are rendered as SVG from a small, immutable geometric model, so
every fold is exact: no meshes, no physics, just reflections and convex
polygon clipping.

## Features

- **Fold along any line.** Drag on the folded sheet to draw a fold line, then
  click the side that should flip over.
- **Fold all layers or only the top _k_.** Choose between folding the whole
  stack or just the top few layers before you click.
- **Live unfolded view.** The right panel always shows the sheet flattened out
  again, with every crease drawn in red.
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
  with a single folded edge. Ctrl+Z (Cmd+Z on macOS) undoes the last fold and
  Esc cancels a fold line you are drawing.
- **Light and dark themes.** The interface follows the operating system's
  colour scheme and works down to phone widths.

## Getting started

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev        # start the dev server
npm run build      # static site in dist/
npm run preview    # serve the production build locally
```

Quality checks, which CI runs on every pull request:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
```

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
   half-plane flips over, and `layers` is either `all` or "the top _k_ layers".
   A facet belongs to the top _k_ layers when fewer than _k_ distinct layers
   lie above it at its current position.
2. Each selected facet is cut by the line. The line is pulled back into the
   facet's own coordinates through the inverse transform, and the polygon is
   clipped into the part that stays and the part that moves.
3. The moving part gets the reflection across the fold line composed onto its
   `transform` (`reflection ∘ transform`). The staying part keeps its transform.
   Both keep their polygons in unfolded coordinates.
4. All moved facets are placed on top of the stack with their layer order
   reversed, exactly as a real flap would land.
5. Every facet that was actually cut records a crease: the chord of the fold
   line inside the facet, stored in unfolded coordinates.

Because every facet keeps its unfolded polygon, the unfolded view is simply
every `poly` plus every crease segment. The number of faces is the number of
facets, and the maximum number of layers is the largest number of facets whose
folded polygons share a common region (computed exactly with convex polygon
intersection).

Facet transforms are compositions of reflections, so their determinant is
−1 whenever the facet currently shows its back side; the renderer uses that to
pick the face colour.

### Code layout

| File              | Responsibility                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| `src/geometry.ts` | Vectors, lines, affine transforms, reflections, convex clipping/intersection |
| `src/paper.ts`    | Facet model, `fold`, layer selection, statistics, undo history               |
| `src/render.ts`   | SVG markup for the folded view (with animation) and the unfolded view        |
| `src/ui.ts`       | Toolbar, pointer interaction, animation loop, presets                        |
| `tests/`          | Vitest specs for the geometry and the paper model                            |

## License

MIT. Copyright (c) 2026 Hannes Gao. See [LICENSE](LICENSE).
