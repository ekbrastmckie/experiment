/* force.js v0.16
   Synced to: design-doc v0.11 (resolves physics-plan.txt's three
   OPEN force.js items: momentum/pressure/gravity combine, momentum's
   shape, pressure's scan bound.)

   Motion is Newtonian: each piece carries a velocity, updated from
   real forces (gravity + pressure) every check, not a fixed
   fall-speed lookup. Momentum is just this velocity persisting
   between checks, not a separate force. Pressure doubles as this
   system's drag/buoyancy: a bounded flood-fill through connected
   same-or-denser fluid mass — no separate friction term exists.

   A piece may swap into a target cell only if the target is fluid
   (phase liquid/gas); solids never trade with solids regardless of
   mass (dense stone rests on lighter ice; it sinks through water).
   Mass no longer gates swaps at all, only shapes force and speed.

   Direction is picked by tracking a continuously-accumulated ideal
   (real-valued) position alongside the piece's actual grid position,
   choosing whichever of the 26 neighbors is closest to it each
   check. This self-corrects drift over many steps (unlike picking by
   instantaneous velocity angle alone), so long/shallow paths (a
   flung piece, a long pressure-driven flow) track a true line
   instead of bowing off it.

   Batched like heat.js: countdowns only mark a piece "due";
   processDueForce (call once after each timer.tick()) does the real
   work for everything due that tick.

   (OPEN) Blocked motion (target is solid): velocity/ideal-position
   are zeroed as a placeholder. Whether to instead clamp or bank the
   energy for release once the path opens is undecided.
   (OPEN) Drag beyond the pressure/buoyancy term above is deferred.

   Exports:
     createForceState()                   — fresh tracking state
     startForce(state, board, timer)      — marks every piece due once
     processDueForce(state, board, timer) — call once after each
       timer.tick(); no-op if nothing is due

   Imports:
     board.js  — getPiece, setPiece, PIECE_TYPES
     timing.js — registerCountdown, cancelCountdown
*/

import { getPiece, setPiece, PIECE_TYPES } from './board.js';
import { registerCountdown, cancelCountdown } from './timing.js';

// Tunable, ballparked — expect retuning once visible.
const GRAVITY_ACCEL = 0.02;    // downward accel per check, mass-independent
const PRESSURE_CONST = 0.0015; // scales connected-fluid mass into accel
const PRESSURE_SCAN_CAP = 32;  // max cells visited per pressure flood-fill
const SPEED_BASE = 20;         // ticks-per-swap ~= SPEED_BASE / speed
const MIN_TICKS = 2;
const MIN_SPEED = 0.02;        // below this, piece is stable (sleeps)

function massOf(type) { return PIECE_TYPES[type].mass; }

function isFluid(type) {
  const phase = PIECE_TYPES[type].phase;
  return phase === 'liquid' || phase === 'gas';
}

function posKey(x, y, z) { return `${x},${y},${z}`; }
function parsePosKey(key) { return key.split(',').map(Number); }

const FACE_OFFSETS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

const DIR26 = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx || dy || dz) DIR26.push([dx, dy, dz]);

export function createForceState() {
  return { pendingByPos: new Map(), due: new Set() };
}

function cancelPending(state, timer, key) {
  const id = state.pendingByPos.get(key);
  if (id !== undefined) {
    cancelCountdown(timer, id);
    state.pendingByPos.delete(key);
  }
}

function markDue(state, key) {
  state.pendingByPos.delete(key);
  state.due.add(key);
}

function ensureMotion(piece, x, y, z) {
  if (piece.vx === undefined) {
    piece.vx = 0; piece.vy = 0; piece.vz = 0;
    piece.ix = x; piece.iy = y; piece.iz = z;
  }
}

/* pressureAccel: bounded flood-fill (face-adjacent) through connected
   same-or-denser fluid, summing mass pulled toward the origin from
   each visited cell's direction — the imbalance pushes the origin
   away from where connected fluid mass concentrates (artesian-well
   pushes and motion resistance both fall out of this same term).
   Only fluids feel it; solids feel gravity alone in v0.16. */
function pressureAccel(board, x, y, z, type, mass) {
  if (!isFluid(type)) return [0, 0, 0];
  const visited = new Set([posKey(x, y, z)]);
  const queue = [[x, y, z]];
  let fx = 0, fy = 0, fz = 0;

  for (let head = 0; head < queue.length && visited.size < PRESSURE_SCAN_CAP; head++) {
    const [cx, cy, cz] = queue[head];
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz, key = posKey(nx, ny, nz);
      if (visited.has(key)) continue;
      const n = getPiece(board, nx, ny, nz);
      if (!n || !isFluid(n.type)) continue;
      const nMass = massOf(n.type);
      if (nMass < mass) continue;

      visited.add(key);
      queue.push([nx, ny, nz]);
      const ddx = nx - x, ddy = ny - y, ddz = nz - z;
      const dist = Math.hypot(ddx, ddy, ddz) || 1;
      fx -= nMass * ddx / dist;
      fy -= nMass * ddy / dist;
      fz -= nMass * ddz / dist;
    }
  }
  return [fx * PRESSURE_CONST / mass, fy * PRESSURE_CONST / mass, fz * PRESSURE_CONST / mass];
}

/* pickTarget: of the 26 neighbors, the fluid cell closest to the
   piece's accumulated ideal position (self-correcting over many
   steps, not just instantaneous velocity angle). */
function pickTarget(board, x, y, z, ix, iy, iz) {
  let best = null, bestDist = Infinity;
  for (const [dx, dy, dz] of DIR26) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const n = getPiece(board, nx, ny, nz);
    if (!n || !isFluid(n.type)) continue;
    const d = (ix - nx) ** 2 + (iy - ny) ** 2 + (iz - nz) ** 2;
    if (d < bestDist) { bestDist = d; best = { x: nx, y: ny, z: nz }; }
  }
  return best;
}

function speedToTicks(speed) {
  return Math.max(MIN_TICKS, Math.round(SPEED_BASE / speed));
}

/* checkForce: recomputes one piece's velocity/ideal-position from
   current forces, then sleeps (stable), blocks (placeholder — see
   header OPEN note), or schedules its swap. */
function checkForce(state, board, timer, x, y, z) {
  const piece = getPiece(board, x, y, z);
  if (!piece) return;
  ensureMotion(piece, x, y, z);

  const mass = massOf(piece.type);
  const [px, py, pz] = pressureAccel(board, x, y, z, piece.type, mass);
  piece.vx += px;
  piece.vy += py;
  piece.vz += pz - GRAVITY_ACCEL;
  piece.ix += piece.vx;
  piece.iy += piece.vy;
  piece.iz += piece.vz;

  const speed = Math.hypot(piece.vx, piece.vy, piece.vz);
  if (speed < MIN_SPEED) return; // stable — sleeps until a neighbor disturbs it

  const target = pickTarget(board, x, y, z, piece.ix, piece.iy, piece.iz);
  if (!target) {
    piece.vx = 0; piece.vy = 0; piece.vz = 0;
    piece.ix = x; piece.iy = y; piece.iz = z;
    return;
  }

  const key = posKey(x, y, z);
  const id = registerCountdown(timer, speedToTicks(speed), () => {
    state.pendingByPos.delete(key);
    performSwap(state, board, timer, x, y, z, target.x, target.y, target.z);
  });
  state.pendingByPos.set(key, id);
}

function performSwap(state, board, timer, x, y, z, tx, ty, tz) {
  const here = getPiece(board, x, y, z);
  const there = getPiece(board, tx, ty, tz);
  setPiece(board, x, y, z, there);
  setPiece(board, tx, ty, tz, here);

  const sizeZ = board[0][0].length;
  const wake = new Set([posKey(x, y, z), posKey(tx, ty, tz)]);
  if (z + 1 < sizeZ) wake.add(posKey(x, y, z + 1));
  if (tz + 1 < sizeZ) wake.add(posKey(tx, ty, tz + 1));

  for (const key of wake) {
    cancelPending(state, timer, key);
    const id = registerCountdown(timer, 0, () => markDue(state, key));
    state.pendingByPos.set(key, id);
  }
}

/* processDueForce: call once after each timer.tick(). */
export function processDueForce(state, board, timer) {
  if (state.due.size === 0) return;
  const due = state.due;
  state.due = new Set();
  for (const key of due) {
    const [x, y, z] = parsePosKey(key);
    checkForce(state, board, timer, x, y, z);
  }
}

/* startForce: marks every position due once; the first
   processDueForce call after this does the actual initial work. */
export function startForce(state, board, timer) {
  const sizeX = board.length, sizeY = board[0].length, sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++)
    for (let y = 0; y < sizeY; y++)
      for (let z = 0; z < sizeZ; z++)
        state.due.add(posKey(x, y, z));
}
