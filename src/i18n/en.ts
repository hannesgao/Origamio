/**
 * Every word the interface shows, in English: the source the other
 * languages are checked against. Messages with a value in them are
 * functions, so that each language orders its own sentence.
 */
export const en = {
  /** The language's own name and its BCP 47 tag, for `<html lang>`. */
  name: 'English',
  tag: 'en',
  language: 'Language',

  layouts: {
    'side-by-side': { label: 'Side by side', title: 'All three views in a row' },
    'folded-large': { label: 'Folded large', title: 'A big folded view, the others beside it' },
    focus: { label: 'Focus', title: 'Only the folded view' },
    group: 'Layout',
  },

  panels: {
    library: { label: 'Library', title: 'Presets to load onto the timeline' },
    paper: { label: 'Paper', title: 'Size of the sheet' },
    step: { label: 'Step', title: 'Edit the selected step' },
    file: { label: 'File', title: 'Name, import, export and clear' },
    keys: { label: 'Shortcuts', title: 'Keyboard shortcuts' },
    nav: 'Panels',
    close: 'Close',
    presets: 'Presets',
  },

  paper: {
    square: 'Square 1:1',
    aSeries: 'A series 1:√2',
    portrait: (shape: string) => `${shape} portrait`,
    custom: 'Custom',
    current: (sheet: string) => `Current sheet: ${sheet}`,
    width: 'Sheet width',
    height: 'Sheet height',
    useSize: 'Use this size',
    rotate: 'Rotate (portrait / landscape)',
    rotateTitle: 'Swap width and height',
    customField: 'Custom (width × height, longer side 1 is usual)',
    rewindHelp:
      'Changing the size rewinds to the flat sheet and keeps every step on the timeline, so play to see them on the new sheet.',
    coloursField: 'Colours (front / back)',
    front: 'Front',
    back: 'Back',
    frontColour: 'Front colour',
    backColour: 'Back colour',
    savedHelp: 'Size and colours are saved in exported files.',
    colours: {
      orange: 'Orange and brown (default)',
      kami: 'Kami red and white',
      blue: 'Blue and white',
      green: 'Green and cream',
      kraft: 'Kraft',
      gold: 'Black and gold',
    },
  },

  tabs: {
    folded: 'Folded',
    unfolded: 'Unfolded',
    solid: '3D',
    view: 'View',
    secondary: 'Secondary view',
  },

  transport: {
    timeline: 'Timeline',
    start: 'Back to the flat sheet (Home)',
    back: 'One step back (←)',
    play: 'Play the remaining steps (P)',
    pause: 'Pause after this step (P)',
    forward: 'One step forward (→)',
    end: 'Apply all remaining steps at once (End)',
    speed: 'Speed',
    speedLabel: 'Playback speed',
    track: 'Track',
    hideTrack: 'Hide the track',
    showTrack: 'Show the track',
    steps: 'Fold steps',
    clipTitle: (step: string) =>
      `${step} — click to go there, double-click to rename, drag to move`,
    clipDead: (step: string) => `${step} — moves nothing on the sheet as it is at this point`,
    renameLabel: (n: number) => `Name of step ${n}`,
  },

  file: {
    name: 'Name',
    sequenceName: 'Sequence name',
    untitled: 'Untitled sequence',
    defaultName: 'My sequence',
    import: 'Import file…',
    importTitle: 'Load a sequence from a JSON file',
    export: 'Export file',
    exportTitle: 'Save the timeline as a JSON file',
    newSheet: 'New sheet',
    newTitle: 'Clear the sheet and the timeline',
    help: 'A file holds every step on the timeline, applied and pending, in the origamio-sequence JSON format described in the README.',
  },

  /** The Shortcuts panel: key, then what it does. */
  keys: [
    ['Drag', 'Line tool: draw a fold line, then click the side that flips'],
    ['Drag', 'Point tool: bring a point onto another point'],
    ['Esc', 'Cancel the line, close the panel or menu, pause playback'],
    ['← / →', 'One step back or forward'],
    ['P', 'Play or pause'],
    ['Home / End', 'Flat sheet or last step'],
    ['Ctrl+Z', 'Undo the last edit of the timeline'],
    ['Ctrl+Shift+Z', 'Redo an edit (also Ctrl+Y)'],
    ['Delete', 'Delete the selected step'],
    ['F2', 'Rename the selected step'],
    ['Scroll', 'Zoom around the pointer'],
    ['Space + drag', 'Pan the folded view'],
    ['Alt + drag', 'Draw a fold line without snapping'],
    ['F / 0', 'Fit the sheet or show it whole'],
  ] as readonly (readonly [string, string])[],

  folded: {
    title: 'Folded',
    dragTool: 'Drag tool',
    line: 'Line',
    lineTitle: 'Drag to draw the fold line',
    point: 'Point',
    pointTitle:
      'Drag a point onto another point: the sheet folds along the line halfway between them, so the first point lands on the second',
    move: 'Move',
    moveTitle: 'Drag to pan (or hold Space)',
    layersTitle:
      'Layers moved by the next fold: all of them, or only the top n (a facet is in the top n when fewer than n layers lie above it)',
    all: 'All',
    top: 'Top',
    layerCount: 'Number of top layers to fold',
    snap: 'Snap',
    snapTitle: 'Snap fold lines to corners, midpoints and edges (hold Alt to draw freely)',
    fit: 'Fit',
    fitTitle: 'Fit the folded sheet into view (F)',
    full: 'Full',
    fullTitle: 'Show the whole sheet (0)',
    zoomTitle: 'Zoom; scroll on the sheet to change',
    more: 'More view tools',
    stats: {
      folds: 'folds',
      layers: 'layers',
      facets: 'facets',
      underCursor: 'under cursor',
      creases: 'creases',
    },
  },

  unfolded: {
    title: 'Unfolded',
    frontUp: 'Front side up',
    backUp: 'Back side up',
    crease: 'Crease',
    caption: 'Crease pattern, live',
  },

  solid: {
    title: '3D',
    namedViews: 'Named views',
    views: {
      front: { short: 'Front', title: 'Front view: looking at the face' },
      side: { short: 'Side', title: 'Side view: the profile' },
      top: { short: 'Top', title: 'Top view: from above' },
      isometric: { short: 'Iso', title: 'Isometric view: the side view turned 45°' },
    },
    perspective: 'Perspective',
    perspectiveTitle:
      'Perspective: nearer parts drawn larger. Off, every view is an orthographic drawing',
    reset: 'Reset',
    resetTitle: 'Turn the model back to the default view',
    open: 'Open',
    openingChip: (degrees: number) => `Open every crease by ${degrees}°`,
    openingLabel: 'Crease opening in degrees',
    openingTitle: (max: number) => `Exact opening, 0 to ${max} degrees`,
    openingGroup: 'Crease opening',
    paper: 'Paper',
    thicknessChip: (mm: number, cm: number) => `Paper ${mm} mm thick on a ${cm} cm sheet`,
    thicknessLabel: 'Paper thickness in millimetres',
    thicknessTitle: (max: number) => `Exact thickness, 0 to ${max} mm`,
    thicknessGroup: 'Paper thickness',
    mm: 'mm',
    dragToTurn: 'Drag to turn',
    noWebGL:
      'The 3D view needs WebGL, which this browser does not provide. The other views still work.',
  },

  credits: {
    copyright: '© 2026 Hannes Gao',
    licence: 'MIT License',
    licenceTitle: 'Read the licence',
    built: (iso: string) => `Built ${iso} (UTC)`,
    github: 'GitHub',
    githubTitle: 'Origamio on GitHub',
  },

  /** The line under the folded sheet: what a drag does now. */
  hints: {
    redrawPoint: (n: number) =>
      `Redrawing step ${n}: drag a point onto the point it should land on (Esc cancels).`,
    redrawLine: (n: number) =>
      `Redrawing step ${n}: drag the new fold line, then click the side that flips (Esc cancels).`,
    next: (step: string) => `Next: ${step}. Press → to apply it or play (P).`,
    move: 'Drag to pan, scroll to zoom. Switch back to Line or Point to fold.',
    point: 'Drag a corner or point onto the point it should land on.',
    line: 'Drag to draw a fold line. Scroll to zoom, hold Space to pan.',
    releasePoint: 'Release to fold it there.',
    releaseLine: 'Release to set the fold line.',
    snappedCorner: (release: string) => `Snapped to a corner. ${release}`,
    snappedCrossing: (release: string) => `Snapped to where two edges cross. ${release}`,
    snappedMidpoint: (release: string) => `Snapped to the middle of an edge. ${release}`,
    snappedEdge: (release: string) => `Snapped onto an edge. ${release}`,
    chooseSideRedraw: (n: number) => `Click the side that flips for step ${n} (Esc to cancel).`,
    chooseSide: 'Click the side that should flip over (Esc to cancel).',
    playing: 'Playing… (P or Esc to pause after this step)',
    folding: 'Folding…',
  },

  /** A step without a name is described by what it folds. */
  step: {
    foldAll: 'Fold all',
    foldTop: (n: number) => `Fold top ${n}`,
    foldBottom: (n: number) => `Fold bottom ${n}`,
    placed: (which: string, placement: string) => `${which} (${placement})`,
    placements: { top: 'top', bottom: 'underneath', inside: 'inside' },
  },

  status: {
    noSteps: 'No steps',
    stepOf: (position: string, length: string) => `Step ${position} of ${length}`,
  },

  inspector: {
    emptyNoSteps: 'Fold something or load a preset, then select a step on the timeline.',
    emptySelect: 'Select a step on the timeline (click a clip) to edit it here.',
    changed: (what: string, n: number) => `${what} of step ${n} changed.`,
    name: 'Name',
    stepName: 'Step name',
    layers: 'Layers that move',
    layersAll: 'All layers',
    layersTop: 'Top n layers',
    layersBottom: 'Bottom n layers',
    layerCount: 'Number of layers',
    placement: 'Where the moved paper lands',
    placementTop: 'On top (valley fold)',
    placementBottom: 'Underneath (on the back)',
    placementInside: 'Inside (reverse fold)',
    flip: 'Flip which side moves',
    redraw: 'Redraw the line on the folded sheet',
    redrawing: 'Redrawing… (Esc cancels)',
    coincide: 'Could not change the line: the two points would coincide.',
    from: 'From',
    to: 'To',
    regionLimit: 'Only facets inside a region of the unfolded sheet',
    windowLimit: 'Only facets inside a window of the folded sheet',
    points: (text: string, n: number) => `${text} (${n} points)`,
    remove: 'Remove',
    title: (n: number, length: number) => `Step ${n} of ${length}`,
    movesNothing: ' — moves nothing where it now sits',
    moreFolds: (n: number) =>
      `This step makes ${n} more fold${n === 1 ? '' : 's'} at the same time; the fields below are its first fold.`,
    foldLine: (side: 'left' | 'right') =>
      `Fold line (folded coordinates at this step; the ${side} side moves)`,
    limits: 'Limits',
    replayHelp:
      'Every change replays the steps after this one; a step that then moves nothing is marked on the timeline.',
    what: {
      layers: 'Layers',
      placement: 'Placement',
      side: 'Side',
      line: 'Line',
      region: 'Region',
      window: 'Window',
    },
  },

  /** Messages in the status bar. */
  messages: {
    drawNewLine: (n: number) => `Draw the new line for step ${n} on the folded sheet.`,
    laterDead: (message: string, n: number) =>
      `${message} ${n} later step${n === 1 ? ' now moves' : 's now move'} nothing.`,
    movesNothing: 'That fold moves nothing.',
    inserted: (n: number) => `Inserted step ${n}.`,
    tookAlong: (n: number) =>
      ` It took ${n} attached facet${n === 1 ? '' : 's'} along so the paper does not tear.`,
    sheetSetFor: (sheet: string, name: string) => `Sheet set to ${sheet} for "${name}".`,
    sheetNow: (sheet: string, steps: number) => `Sheet is now ${sheet}; ${steps} steps rewound.`,
    saved: (n: number) => `Saved ${n} steps.`,
    loaded: (name: string, n: number, sheet: string) =>
      `Loaded "${name}": ${n} steps on a ${sheet} sheet. Press play.`,
    loadedPreset: (name: string, n: number, sheet: string) =>
      `Loaded "${name}": ${n} steps on a ${sheet} sheet. Step with → or play.`,
    couldNotLoad: (file: string, reason: string) => `Could not load ${file}: ${reason}`,
    unreadable: 'unreadable file',
    deleted: (n: number) => `Deleted step ${n}.`,
    duplicated: (n: number) => `Duplicated step ${n}.`,
    moved: (from: number, to: number) => `Moved step ${from} to ${to}.`,
    removedAfter: (count: number, n: number) =>
      `Removed ${count} step${count === 1 ? '' : 's'} after step ${n}.`,
    nothingToUndo: 'Nothing to undo.',
    undid: 'Undid the last edit.',
    nothingToRedo: 'Nothing to redo.',
    redid: 'Redid the edit.',
    lineRedrawn: (n: number) => `Line of step ${n} redrawn.`,
    badSize: (max: number) => `Could not use that size: sides must be between 0 and ${max}.`,
  },

  menu: {
    rename: 'Rename',
    edit: 'Edit…',
    goTo: 'Go to this step',
    duplicate: 'Duplicate',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    delete: 'Delete',
    deleteAfter: 'Delete steps after',
    snapOn: 'Snap to points: on',
    snapOff: 'Snap to points: off',
    fit: 'Fit the sheet (F)',
    full: 'Show the whole sheet (0)',
    zoom: (zoom: string) => `Zoom ${zoom}`,
  },

  /** The shipped sequences, by preset id: the name and the one-line description. */
  presets: {
    'three-halves': {
      name: 'Fold in half ×3',
      description: 'Left over right, top over bottom, left over right again',
    },
    'corner-loose': {
      name: 'Halves + loose corner',
      description:
        'Fold in half twice, then fold the loose corner where the four sheet corners stack',
    },
    'corner-two-edges': {
      name: 'Halves + centre corner',
      description: 'Fold in half twice, then fold the corner where both folded edges meet',
    },
    'corner-one-edge': {
      name: 'Halves + single-edge corner',
      description: 'Fold in half twice, then fold a corner that has only one folded edge',
    },
    crane: {
      name: 'Crane',
      description:
        'Diagonals, preliminary base, bird base, narrow the points, close the model, reverse fold neck, tail and head, wings down',
    },
    frog: {
      name: 'Jumping frog',
      description: 'Waterbomb head with legs, sides in, pleated spring',
    },
  } as Record<string, { readonly name: string; readonly description: string }>,

  /**
   * The step names the shipped sequences carry, by the English name the
   * files store. A name without an entry is shown as stored, so names the
   * user types are never touched.
   */
  stepLabels: {
    'Pre-crease': 'Pre-crease',
    'Square base': 'Square base',
    'Petal fold front': 'Petal fold front',
    'Petal fold back': 'Petal fold back',
    'Narrow front point': 'Narrow front point',
    'Narrow back point': 'Narrow back point',
    'Close along centre': 'Close along centre',
    'Reverse fold neck': 'Reverse fold neck',
    'Reverse fold tail': 'Reverse fold tail',
    'Reverse fold head': 'Reverse fold head',
    'Spread wings': 'Spread wings',
    'Right half over': 'Right half over',
    'Top half down': 'Top half down',
    'Half back down': 'Half back down',
    'Loose corner': 'Loose corner',
    'Centre corner': 'Centre corner',
    'Single-edge corner': 'Single-edge corner',
    Waterbomb: 'Waterbomb',
    'Legs up': 'Legs up',
    'Feet out': 'Feet out',
    'Sides in': 'Sides in',
    'Bottom up': 'Bottom up',
  } as Record<string, string>,
};
