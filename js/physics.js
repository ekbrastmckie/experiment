/* physics.js v0.15
   Rules for inert matter: gravity (density-driven swaps) and
   temperature (conserved heat exchange + phase transitions).

   GRAVITY: unchanged from v0.14 — density-diff-based swap speed,
   solid-vs-fluid movement rules. DENSITY/CATEGORY below now cover
   the full reachable roster (space removed; ice/fire/smoke/steam
   added for phase-transition support). Ice floats on water for
   free, just from the density ordering — no extra gravity code
   needed.

   HEAT: `heat` is the conserved quantity per piece (integer);
   `temperature` = heat / DENSITY[type] is derived, and is what
   gradients, phase thresholds, and recheck urgency actually read.
   Every heat check exchanges with all 26 neighbors at once, each
   transfer scaled to that pair's gradient (steeper gap moves more),
   applied to both sides atomically. Heat only enters/leaves the
   system via the floor/ceiling boundary injection — nothing else
   creates or destroys it.

   PHASE TRANSITIONS: checked against temperature. Stone<->magma
   uses the TARGET type's mass for its threshold instead of the
   current type's — this widens the gap on purpose, so a converted
   piece doesn't land in temperature territory that immediately
   flips it back (magma is denser than stone, so plain conservation
   oscillates at the boundary otherwise). Water<->ice and
   water<->steam don't need this fix: their mass ratios already
   push a converted piece safely away from the threshold.

   Exports:
     DENSITY, CATEGORY        — type tables (mass doubles as density)
     createPhysicsState()     — fresh tracking state
     checkFall / startGravity / fillRandom — gravity, as before
     checkHeat / startHeat    — heat exchange, phase transitions,
                                 and floor/ceiling injection

   Imports:
     board.js  — getPiece, setPiece, PIECE_TYPES
     timing.js — registerCountdown, cancelCountdown
*/

import { getPiece, setPiece, PIECE_TYPES } from './board.js';
import { registerCountdown, cancelCountdown } from './timing.js';

// Mass/density, one table for both jobs. No 'space' entry — space
// is unreachable (see fillRandom; main.js's initial fillType is
// overwritten before anything ever reads it).
export const DENSITY = {
  magma: 30,
  stone: 25,
  water: 10,
  ice: 9,
  air: 2,
  fire: 1,
  smoke: 1,
  steam: 1
};

export const CATEGORY = {
  magma: 'liquid',
  stone: 'solid',
  water: 'liquid',
  ice: 'solid',
  air: 'gas',
  fire: 'gas',
  smoke: 'gas',
  steam: 'gas'
};

function isFluid(type) {
  return CATEGORY[type] !== 'solid';
}

function densityOf(piece) {
  const d = DENSITY[piece.type];
  return d === undefined ? 0 : d;
}

function tempOf(piece) {
  return piece.heat / DENSITY[piece.type];
}

// ---------------------------------------------------------------
// Fill
// ---------------------------------------------------------------

const FILL_TYPES = ['magma', 'stone', 'water', 'air'];
const DEFAULT_TEMP = { magma: 90, stone: 3, water: 3, air: 3 };

/* fillRandom: overwrites every position with a uniform-random pick
   from FILL_TYPES, computing each piece's starting heat from its
   default temperature and mass. */
export function fillRandom(board) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const type = FILL_TYPES[Math.floor(Math.random() * FILL_TYPES.length)];
        const temperature = DEFAULT_TEMP[type];
        setPiece(board, x, y, z, {
          type,
          heat: temperature * DENSITY[type],
          temperature,
          transp: PIECE_TYPES[type].transp
        });
      }
    }
  }
}

// ---------------------------------------------------------------
// Shared pending-countdown tracking (keyed by moveType + position,
// so fall and heat can each have their own pending countdown at
// the same position without clobbering each other)
// ---------------------------------------------------------------

function posKey(x, y, z) {
  return `${x},${y},${z}`;
}

function pendingKey(moveType, x, y, z) {
  return `${moveType}:${x},${y},${z}`;
}

export function createPhysicsState() {
  return {
    pendingByPos: new Map() // "moveType:x,y,z" -> countdown id
  };
}

function cancelPending(state, timer, key) {
  const existing = state.pendingByPos.get(key);
  if (existing !== undefined) {
    cancelCountdown(timer, existing);
    state.pendingByPos.delete(key);
  }
}

// ---------------------------------------------------------------
// GRAVITY
// ---------------------------------------------------------------

const FALL_BASE = 20;
const FALL_MIN_TICKS = 2;

function fallTicks(diff) {
  return Math.max(FALL_MIN_TICKS, Math.round(FALL_BASE / diff));
}

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

export function checkFall(state, board, timer, x, y, z) {
  const key = pendingKey('fall', x, y, z);
  cancelPending(state, timer, key);

  if (z === 0) return;

  const here = getPiece(board, x, y, z);
  if (!here) return;

  const target = isFluid(here.type)
    ? findFluidTarget(board, x, y, z, here)
    : findSolidTarget(board, x, y, z, here);

  if (!target) return;

  const id = registerCountdown(timer, fallTicks(target.diff), () => {
    state.pendingByPos.delete(key);
    performSwap(state, board, timer, x, y, z, target.x, target.y, target.z);
  });
  state.pendingByPos.set(key, id);
}

function findSolidTarget(board, x, y, z, here) {
  const below = getPiece(board, x, y, z - 1);
  if (!below) return null;
  const diff = densityOf(here) - densityOf(below);
  if (diff <= 0) return null;
  return { x, y, z: z - 1, diff };
}

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
  return null;
}

function performSwap(state, board, timer, x, y, z, tx, ty, tz) {
  const here = getPiece(board, x, y, z);
  const target = getPiece(board, tx, ty, tz);
  setPiece(board, x, y, z, target);
  setPiece(board, tx, ty, tz, here);

  const sizeZ = board[0][0].length;
  const toRecheck = new Set([
    posKey(x, y, z),
    posKey(tx, ty, tz)
  ]);
  if (z + 1 < sizeZ) toRecheck.add(posKey(x, y, z + 1));
  if (tz + 1 < sizeZ) toRecheck.add(posKey(tx, ty, tz + 1));

  for (const key of toRecheck) {
    const [rx, ry, rz] = key.split(',').map(Number);
    checkFall(state, board, timer, rx, ry, rz);
  }
}

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

// ---------------------------------------------------------------
// HEAT — phase transitions
// ---------------------------------------------------------------

// useTargetMass: true only where plain conservation would oscillate
// at the boundary (see header). when: comparator against
// thresholdTemp, checked in temperature (heat / relevant mass).
const PHASE_RULES = {
  water: [
    { toType: 'ice',   thresholdTemp: 0,  when: 'lte', useTargetMass: false },
    { toType: 'steam', thresholdTemp: 10, when: 'gte', useTargetMass: false }
  ],
  ice: [
    { toType: 'water', thresholdTemp: 0, when: 'gt', useTargetMass: false }
  ],
  steam: [
    { toType: 'water', thresholdTemp: 10, when: 'lt', useTargetMass: false }
  ],
  stone: [
    { toType: 'magma', thresholdTemp: 80, when: 'gte', useTargetMass: true }
  ],
  magma: [
    { toType: 'stone', thresholdTemp: 80, when: 'lt', useTargetMass: true }
  ]
};

function checkPhase(piece) {
  const rules = PHASE_RULES[piece.type];
  if (!rules) return false;

  for (const rule of rules) {
    const checkTemp = rule.useTargetMass
      ? piece.heat / DENSITY[rule.toType]
      : tempOf(piece);

    const passes =
      rule.when === 'gte' ? checkTemp >= rule.thresholdTemp :
      rule.when === 'lte' ? checkTemp <= rule.thresholdTemp :
      rule.when === 'gt'  ? checkTemp >  rule.thresholdTemp :
      rule.when === 'lt'  ? checkTemp <  rule.thresholdTemp : false;

    if (passes) {
      piece.type = rule.toType;               // heat unchanged (conserved)
      piece.transp = PIECE_TYPES[rule.toType].transp;
      piece.temperature = tempOf(piece);       // mass changed, so temp is recomputed
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------
// HEAT — transfer, recheck scheduling, boundary injection
// ---------------------------------------------------------------

const HEAT_TRANSFER_DIVISOR = 4; // tunable: bigger = slower transfer per check

const ROOM_TEMP = 3;
const WINDOW = 2;
const HEAT_BASE = 40;
const HEAT_MIN_TICKS = 4;

const FLOOR_HEAT_INJECT = 20;    // heat units added at z=0 each tick
const CEILING_HEAT_EXTRACT = 20; // heat units removed at top layer each tick

const NEIGHBOR_OFFSETS = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      NEIGHBOR_OFFSETS.push([dx, dy, dz]);
    }
  }
}

function nearestThresholdDistance(piece) {
  const rules = PHASE_RULES[piece.type];
  if (!rules || rules.length === 0) return Infinity;
  const temp = tempOf(piece);
  let min = Infinity;
  for (const rule of rules) {
    min = Math.min(min, Math.abs(temp - rule.thresholdTemp));
  }
  return min;
}

function heatRecheckTicks(piece) {
  const temp = tempOf(piece);
  const distanceFromRoom = Math.abs(temp - ROOM_TEMP);
  const proximityUrgency = Math.max(0, WINDOW - nearestThresholdDistance(piece));
  const urgency = distanceFromRoom + proximityUrgency;
  return Math.max(HEAT_MIN_TICKS, Math.round(HEAT_BASE - urgency));
}

/* checkHeat: exchanges heat with all 26 neighbors at once, each
   transfer scaled to that pair's gradient and applied to both sides
   atomically (conserved). Checks for a phase transition afterward.
   If nothing moved and nothing transitioned, the piece is stable
   and isn't rescheduled — it wakes again only if a neighbor's own
   check later disturbs it. */
export function checkHeat(state, board, timer, x, y, z) {
  const key = pendingKey('heat', x, y, z);
  cancelPending(state, timer, key);

  const piece = getPiece(board, x, y, z);
  if (!piece) return;

  // First pass: collect valid neighbors so the transfer below can be
  // scaled by how many there are. Without this, a piece with more
  // neighbors moves proportionally more total heat per check than
  // one with fewer — which breaks "split across all neighbors" and
  // made everything equilibrate far too fast.
  const neighbors = [];
  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const neighbor = getPiece(board, nx, ny, nz);
    if (neighbor) neighbors.push([nx, ny, nz, neighbor]);
  }

  let anyTransfer = false;
  const touchedNeighbors = [];

  for (const [nx, ny, nz, neighbor] of neighbors) {
    const gradient = tempOf(piece) - tempOf(neighbor);
    const transferred = Math.round(gradient / (HEAT_TRANSFER_DIVISOR * neighbors.length));
    if (transferred === 0) continue;

    piece.heat -= transferred;
    neighbor.heat += transferred;
    piece.temperature = tempOf(piece);
    neighbor.temperature = tempOf(neighbor);

    anyTransfer = true;
    touchedNeighbors.push([nx, ny, nz]);
  }

  const transitioned = checkPhase(piece);
  if (transitioned) {
    checkFall(state, board, timer, x, y, z); // density/category may have changed
  }

  if (anyTransfer || transitioned) {
    const ticks = heatRecheckTicks(piece);
    const id = registerCountdown(timer, ticks, () => {
      state.pendingByPos.delete(key);
      checkHeat(state, board, timer, x, y, z);
    });
    state.pendingByPos.set(key, id);

    // Deferred (not called directly): two neighbors alternately
    // nudging each other can otherwise recurse synchronously
    // forever if rounding never lets the gradient settle to 0
    // within one pass. A 0-tick countdown gets the same "check
    // again right away" effect via timing.js's queue instead of
    // the call stack.
    for (const [nx, ny, nz] of touchedNeighbors) {
      const nKey = pendingKey('heat', nx, ny, nz);
      cancelPending(state, timer, nKey);
      const nId = registerCountdown(timer, 0, () => {
        state.pendingByPos.delete(nKey);
        checkHeat(state, board, timer, nx, ny, nz);
      });
      state.pendingByPos.set(nKey, nId);
    }
  }
}

/* applyBoundaryHeat: the only source/sink of heat in the system.
   Injects a fixed heat amount at z=0 and removes one at the top
   layer, every tick, unconditionally. Because temperature = heat /
   mass, a fixed heat amount naturally produces a smaller temperature
   swing for heavier pieces — no extra division needed. Re-triggers
   checkHeat on affected pieces so the change actually propagates. */
function applyBoundaryHeat(state, board, timer) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  const top = sizeZ - 1;

  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      const bottom = getPiece(board, x, y, 0);
      if (bottom) {
        bottom.heat += FLOOR_HEAT_INJECT;
        bottom.temperature = tempOf(bottom);
        checkHeat(state, board, timer, x, y, 0);
      }
      if (top > 0) {
        const topPiece = getPiece(board, x, y, top);
        if (topPiece) {
          topPiece.heat -= CEILING_HEAT_EXTRACT;
          topPiece.temperature = tempOf(topPiece);
          checkHeat(state, board, timer, x, y, top);
        }
      }
    }
  }

  registerCountdown(timer, 1, () => applyBoundaryHeat(state, board, timer));
}

/* startHeat: scans every position once for an initial heat check,
   then kicks off the self-perpetuating floor/ceiling injection. */
export function startHeat(state, board, timer) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        checkHeat(state, board, timer, x, y, z);
      }
    }
  }
  registerCountdown(timer, 1, () => applyBoundaryHeat(state, board, timer));
}
