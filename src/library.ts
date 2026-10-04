/**
 * The presets the app ships with, loaded from the JSON files in `presets/`.
 * Those files are generated from `src/presets.ts` (see `npm run presets:write`)
 * and are the reusable form of every sequence.
 */
import cornerLoose from '../presets/corner-loose.json';
import cornerOneEdge from '../presets/corner-one-edge.json';
import cornerTwoEdges from '../presets/corner-two-edges.json';
import crane from '../presets/crane.json';
import dog from '../presets/dog.json';
import rabbit from '../presets/rabbit.json';
import frog from '../presets/frog.json';
import threeHalves from '../presets/three-halves.json';
import { type Sequence, parseSequence } from './sequence';

export interface LibraryEntry {
  readonly id: string;
  readonly sequence: Sequence;
}

const sources: readonly [string, unknown][] = [
  ['three-halves', threeHalves],
  ['corner-loose', cornerLoose],
  ['corner-two-edges', cornerTwoEdges],
  ['corner-one-edge', cornerOneEdge],
  ['crane', crane],
  ['dog', dog],
  ['rabbit', rabbit],
  ['frog', frog],
];

export const LIBRARY: readonly LibraryEntry[] = sources.map(([id, json]) => ({
  id,
  sequence: parseSequence(json),
}));
