/* physics.js
   Rules for inert matter. Gravity is a piece-trade (swap) — an
   unstable piece swaps with a lower-density piece near it, repeatedly,
   until things settle. This exercises timing.js's countdown machinery
   for real (many pieces, many simultaneous pending countdowns,
   cancellations when a piece's situation changes before its swap
   fires).

   SOLIDS vs FLUIDS move differently:
     - Solid (stone): stable if the single piece directly below has
       equal or higher density. Unstable pieces fall straight down
       only — no rolling/spreading.
     - Fluid (water, magma, air, space — liquids and gases treated
       the same, per design call): stable only if ALL 9 cells in the
       3x3 footprint directly below (straight down + the 8 side/
       diagonal neighbors one z down) have equal or higher density.
       An unstable fluid tries straight down first; if that cell
       isn't lower density, it checks the other 8 in random order and
       moves into the first one that is. A footprint cell outside the
       board counts as a wall (equal/higher density) — fluids don't
       flow off the edge of the grid.

   Fall speed depends on the density DIFFERENCE between a piece and
   wherever it's actually moving into — a bigger gap swaps faster.
   Linear: ticks = round(FALL_BASE / diff), floored at FALL_MIN_TICKS
   so it never hits zero.

   Density lives HERE, not in board.js's PIECE_TYPES — board.js is
   frozen as-is per design-doc-v0.10. Density order (low -> high):
   space < air < water < stone < magma. (Stone floats in magma but
   sinks in water/air/space — decided per-sim, not meant to be
   universally "realistic".)

   Exports:
     DENSITY              — { typeName: number }, low = floats, high = sinks
     CATEGORY              — { typeName: 'solid' | 'liquid' | 'gas' }
     createPhysicsState() — fresh state for tracking pending checks.
       Pass this into every function below, same pattern as
       timing.js's createTimer() — no module-level global state.
     checkFall(state, board, timer, x, y, z)
                          — figures out whether the piece at (x,y,z)
       is a solid or fluid and dispatches to the matching stability
       check. Schedules a swap if unstable. Cancels any previously
       pending check at this position first, so a position is never
       watched by two countdowns at once. Safe to call on any
       position at any time (e.g. after manually editing the board)
       to re-settle it.
     startGravity(state, board, timer)
                          — scans the whole board once and calls
       checkFall on every position. Call this once after filling a
       board with pieces.

   Imports:
     from board.js  — getPiece, setPiece
     from timing.js — registerCountdown, cancelCountdown

   Depends on: board.js (built), timing.js (built).
*/

import { getPiece, setPiece, PIECE_TYPES } from './board.js';
import { registerCountdown, cancelCountdown } from './timing.js';

export const DENSITY = {
  space: 0,
  air: 1,
  water: 2,
  stone: 3,
  magma: 4
};

// Liquids and gases share identical movement rules for our purposes,
// so this only needs to distinguish solid vs. everything else — but
// keeping liquid/gas labeled separately in case they diverge later
// (e.g. gases rising instead of falling, once buoyancy exists).
export const CATEGORY = {
  space: 'gas',
  air: 'gas',
  water: 'liquid',
  stone: 'solid',
  magma: 'liquid'
};

function isFluid(type) {
  return CATEGORY[type] !== 'solid';
}

const FALL_BASE = 20;     // ticks at diff = 1
const FALL_MIN_TICKS = 2; // floor, so a huge density gap never hits 0 ticks

/* fallTicks: linear mapping from density difference to swap speed.
   diff 1 -> 20 ticks, diff 2 -> 10, diff 3 -> 7, diff 4 -> 5, etc. */
function fallTicks(diff) {
  return Math.max(FALL_MIN_TICKS, Math.round(FALL_BASE / diff));
}

const FILL_TYPES = ['space', 'air', 'water', 'stone', 'magma'];

/* fillRandom: overwrites every position in the board with a random
   pick from FILL_TYPES, roughly equal proportion (uniform random
   per cell). Use this instead of board.js's createBoard fill for a
   "let it sort itself out" demo. */
export function fillRandom(board) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const type = FILL_TYPES[Math.floor(Math.random() * FILL_TYPES.length)];
        setPiece(board, x, y, z, { type, temperature: PIECE_TYPES[type].temperature, transp: PIECE_TYPES[type].transp });
      }
    }
  }
}

function densityOf(piece) {
  const d = DENSITY[piece.type];
  return d === undefined ? 0 : d;
}

function posKey(x, y, z) {
  return `${x},${y},${z}`;
}

/* createPhysicsState: fresh, independent tracking state. Holds one
   pending-countdown id per position so a position is never checked
   by more than one countdown racing at once. */
export function createPhysicsState() {
  return {
    pendingByPos: new Map() // posKey -> countdown id
  };
}

// Offsets for the 8 side/diagonal footprint cells (straight down,
// dx=0,dy=0, is handled separately and tried first).
const SIDE_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1]
];

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* checkFall: dispatches to the solid or fluid stability check based
   on the piece's category, and schedules a swap if it's unstable.
   Always cancels any previously pending check at this position
   first, so a position is never watched by two countdowns at once. */
export function checkFall(state, board, timer, x, y, z) {
  const key = posKey(x, y, z);
  const existing = state.pendingByPos.get(key);
  if (existing !== undefined) {
    cancelCountdown(timer, existing);
    state.pendingByPos.delete(key);
  }

  if (z === 0) return; // floor, nothing below to fall into

  const here = getPiece(board, x, y, z);
  if (!here) return;

  const target = isFluid(here.type)
    ? findFluidTarget(board, x, y, z, here)
    : findSolidTarget(board, x, y, z, here);

  if (!target) return; // stable, nothing scheduled

  const id = registerCountdown(timer, fallTicks(target.diff), () => {
    state.pendingByPos.delete(key);
    performSwap(state, board, timer, x, y, z, target.x, target.y, target.z);
  });
  state.pendingByPos.set(key, id);
}

/* findSolidTarget: solids only ever consider the single cell
   directly below. Returns { x, y, z, diff } if that cell is lower
   density (unstable), or null if stable. */
function findSolidTarget(board, x, y, z, here) {
  const below = getPiece(board, x, y, z - 1);
  if (!below) return null;

  const diff = densityOf(here) - densityOf(below);
  if (diff <= 0) return null; // stable: equal or higher density below

  return { x, y, z: z - 1, diff };
}

/* findFluidTarget: fluids check the full 3x3 footprint one z below.
   Straight down is tried first; if it doesn't qualify, the other 8
   cells are checked in random order and the first qualifying one
   wins. A footprint cell outside the board is treated as a wall
   (never qualifies). Returns { x, y, z, diff } or null if stable
   (every footprint cell is equal/higher density, including edges). */
function findFluidTarget(board, x, y, z, here) {
  const hereDensity = densityOf(here);

  const straight = getPiece(board, x, y, z - 1);
  if (straight && densityOf(straight) < hereDensity) {
    return { x, y, z: z - 1, diff: hereDensity - densityOf(straight) };
  }

  for (const [dx, dy] of shuffled(SIDE_OFFSETS)) {
    const nx = x + dx;
    const ny = y + dy;
    const piece = getPiece(board, nx, ny, z - 1);
    if (piece && densityOf(piece) < hereDensity) {
      return { x: nx, y: ny, z: z - 1, diff: hereDensity - densityOf(piece) };
    }
  }

  return null; // stable: nothing in the footprint is lower density
}

/* performSwap: trades the piece at (x,y,z) with the piece at
   (tx,ty,tz), then re-checks every position whose stability could
   have just changed: both swapped spots, and whatever sits directly
   above each of them (their support just changed, so they might now
   be unstable too). For a straight-down solid swap these collapse to
   the same 3 positions as before; a lateral fluid move touches a 4th. */
function performSwap(state, board, timer, x, y, z, tx, ty, tz) {
  const here = getPiece(board, x, y, z);
  const target = getPiece(board, tx, ty, tz);
  setPiece(board, x, y, z, target);
  setPiece(board, tx, ty, tz, here);

  const sizeZ = board[0][0].length;
  const toRecheck = new Set([
    posKey(x, y, z),     // pushed-up piece: might now be unstable
    posKey(tx, ty, tz)   // fallen/moved piece: might keep falling
  ]);
  if (z + 1 < sizeZ) toRecheck.add(posKey(x, y, z + 1));       // above old spot
  if (tz + 1 < sizeZ) toRecheck.add(posKey(tx, ty, tz + 1));   // above new spot

  for (const key of toRecheck) {
    const [rx, ry, rz] = key.split(',').map(Number);
    checkFall(state, board, timer, rx, ry, rz);
  }
}

/* startGravity: scans every position once and kicks off a fall
   check wherever needed. Call this once after filling a board. */
export function startGravity(state, board, timer) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        checkFall(state, board, timer, x, y, z);
      }
    }
  }
}
