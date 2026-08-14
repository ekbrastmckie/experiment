/* physics.js
   Rules for inert matter. First slice: gravity as a piece-trade
   (swap) — a denser piece swaps downward with whatever's below it,
   repeatedly, until every column is sorted by density. This is
   deliberately the simplest possible thing that exercises
   timing.js's countdown machinery for real (many pieces, many
   simultaneous pending countdowns, cancellations when a piece's
   situation changes before its swap fires).

   Fall speed depends on the density DIFFERENCE between a piece and
   whatever's below it — a bigger gap swaps faster. Stone falls
   through air faster than through water, since stone-vs-air is a
   bigger density gap than stone-vs-water. Relationship is linear:
   ticks = round(FALL_BASE / diff), floored at FALL_MIN_TICKS so it
   never hits zero. No acceleration/terminal velocity within a
   single swap — this is still one flat speed per swap, just no
   longer the same flat speed for every density pair.

   Density lives HERE, not in board.js's PIECE_TYPES — board.js is
   frozen as-is per design-doc-v0.10. Density order (low -> high):
   space < air < water < stone < magma. (Stone floats in magma but
   sinks in water/air/space — decided per-sim, not meant to be
   universally "realistic".)

   Exports:
     DENSITY            — { typeName: number }, low = floats, high = sinks
     createPhysicsState() — fresh state for tracking pending checks.
       Pass this into every function below, same pattern as
       timing.js's createTimer() — no module-level global state.
     checkFall(state, board, timer, x, y, z)
                         — compares the piece at (x,y,z) to the piece
       below it. If denser, schedules a swap after FALL_TICKS ticks.
       Cancels any previously pending check at this position first,
       so a position is never watched by two countdowns at once.
       Safe to call on any position at any time (e.g. after manually
       editing the board) to re-settle it.
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

const FALL_BASE = 20;     // ticks at diff = 1 (matches old flat FALL_TICKS)
const FALL_MIN_TICKS = 2; // floor, so a huge density gap never hits 0 ticks

/* fallTicks: linear mapping from density difference to swap speed.
   diff 1 -> 20 ticks, diff 2 -> 10, diff 3 -> 7, diff 4 -> 5, etc.
   "Whatever's easy for now" per design call — swap for a curve or
   manual table later without touching checkFall's logic. */
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

/* checkFall: compares the piece at (x,y,z) to the piece directly
   below it. If the piece here is strictly denser (unstable), it
   schedules a swap after fallTicks(diff) ticks — bigger density gap,
   sooner it fires. If it's not (stable — equal or lower density than
   what's below), any previously pending check here is simply
   cancelled and nothing new is scheduled. */
export function checkFall(state, board, timer, x, y, z) {
  const key = posKey(x, y, z);
  const existing = state.pendingByPos.get(key);
  if (existing !== undefined) {
    cancelCountdown(timer, existing);
    state.pendingByPos.delete(key);
  }

  if (z === 0) return; // floor, nothing below to fall into

  const here = getPiece(board, x, y, z);
  const below = getPiece(board, x, y, z - 1);
  if (!here || !below) return;

  const diff = densityOf(here) - densityOf(below);
  if (diff <= 0) return; // stable: equal or higher density below

  const id = registerCountdown(timer, fallTicks(diff), () => {
    state.pendingByPos.delete(key);
    performSwap(state, board, timer, x, y, z);
  });
  state.pendingByPos.set(key, id);
}

/* performSwap: trades the piece at (x,y,z) with the piece below it,
   then re-checks every position whose stability could have just
   changed: the fallen piece's new spot, the pushed-up piece's new
   spot, and whatever sits above that (its neighbor-below just
   changed, so it might now be unstable too). */
function performSwap(state, board, timer, x, y, z) {
  const here = getPiece(board, x, y, z);
  const below = getPiece(board, x, y, z - 1);
  setPiece(board, x, y, z, below);
  setPiece(board, x, y, z - 1, here);

  checkFall(state, board, timer, x, y, z - 1); // fallen piece: might keep falling
  checkFall(state, board, timer, x, y, z);     // pushed-up piece: might now be unstable

  const sizeZ = board[0][0].length;
  if (z + 1 < sizeZ) checkFall(state, board, timer, x, y, z + 1); // its neighbor above
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
