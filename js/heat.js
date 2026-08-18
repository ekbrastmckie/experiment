/* heat.js v0.16
   Synced to: design-doc v0.11

   Temperature and phase transitions. Extracted from physics.js
   (which held both gravity and heat through v0.15) and rearchitected
   from immediate per-neighbor mutation to a batched, order-independent
   pass: countdowns (via timing.js's existing urgency-based scheduler)
   only mark a piece "due"; processDueHeat, called once after each
   timer.tick(), snapshots every due piece and its neighbors, computes
   every transfer from that frozen snapshot, then applies all deltas
   together. Two pieces both due the same tick each still run a full
   transfer against each other (consistent with the old per-piece
   model, just synchronized instead of sequential).

   heat is the conserved integer quantity per piece; temperature
   (heat / PIECE_TYPES[type].mass) is never stored, always derived.
   Heat enters/exits only via floor/ceiling boundary injection.

   Exports:
     createHeatState()                 — fresh tracking state
     startHeat(state, board, timer)    — initial scan + boundary loop
     processDueHeat(state, board, timer) — call once after each
       timer.tick(); no-op if nothing is due
     seedHeat(board)                   — sets each piece's starting
       heat from its type's default temperature (replaces the old
       fillRandom's inline heat computation; board.js's setBoard
       leaves heat unset since board.js has no mass table)

   Imports:
     board.js  — getPiece, setPiece, PIECE_TYPES
     timing.js — registerCountdown, cancelCountdown
*/

import { getPiece, PIECE_TYPES } from './board.js';
import { registerCountdown, cancelCountdown } from './timing.js';

function posKey(x, y, z) {
  return `${x},${y},${z}`;
}

function parsePosKey(key) {
  return key.split(',').map(Number);
}

export function createHeatState() {
  return {
    pendingByPos: new Map(), // posKey -> countdown id, for the per-piece recheck schedule
    due: new Set()           // posKeys whose countdown fired since the last processDueHeat
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
// Starting heat
// ---------------------------------------------------------------

/* seedHeat: sets every piece's heat from its type's default
   temperature (PIECE_TYPES[type].temperature * mass). Call once
   right after board.js's setBoard, before startHeat. */
export function seedHeat(board) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const piece = getPiece(board, x, y, z);
        const info = PIECE_TYPES[piece.type];
        piece.heat = info.temperature * info.mass;
      }
    }
  }
}

// ---------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------

function tempOf(piece) {
  return piece.heat / PIECE_TYPES[piece.type].mass;
}

// useTargetMass: true only where plain conservation would oscillate
// at the boundary (magma is denser than stone, so checking against
// stone's own mass would flip a freshly-converted piece right back).
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
      ? piece.heat / PIECE_TYPES[rule.toType].mass
      : tempOf(piece);

    const passes =
      rule.when === 'gte' ? checkTemp >= rule.thresholdTemp :
      rule.when === 'lte' ? checkTemp <= rule.thresholdTemp :
      rule.when === 'gt'  ? checkTemp >  rule.thresholdTemp :
      rule.when === 'lt'  ? checkTemp <  rule.thresholdTemp : false;

    if (passes) {
      piece.type = rule.toType; // heat unchanged (conserved)
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------
// Recheck scheduling (urgency-based, unchanged from v0.15)
// ---------------------------------------------------------------

const ROOM_TEMP = 3;
const WINDOW = 2;
const HEAT_BASE = 40;
const HEAT_MIN_TICKS = 4;

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

// ---------------------------------------------------------------
// Due-marking (the countdown callback) and batched processing
// ---------------------------------------------------------------

const NEIGHBOR_OFFSETS = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      NEIGHBOR_OFFSETS.push([dx, dy, dz]);
    }
  }
}

const HEAT_TRANSFER_DIVISOR = 4; // tunable: bigger = slower transfer per check

/* markDue: the countdown callback — cheap, no board mutation. Just
   flags the position for the next processDueHeat pass. */
function markDue(state, timer, board, x, y, z) {
  const key = posKey(x, y, z);
  state.pendingByPos.delete(key);
  state.due.add(key);
}

/* scheduleNextCheck: (re)registers this position's next urgency-based
   countdown, firing markDue when it's due. */
function scheduleNextCheck(state, board, timer, x, y, z) {
  const key = posKey(x, y, z);
  cancelPending(state, timer, key);

  const piece = getPiece(board, x, y, z);
  if (!piece) return;

  const ticks = heatRecheckTicks(piece);
  const id = registerCountdown(timer, ticks, () => markDue(state, timer, board, x, y, z));
  state.pendingByPos.set(key, id);
}

/* processDueHeat: call once after each timer.tick(). Snapshots every
   due piece and its neighbors, computes every transfer from that
   frozen snapshot, applies all deltas together, then checks phase
   and reschedules for everything touched. No-op if nothing is due. */
export function processDueHeat(state, board, timer) {
  if (state.due.size === 0) return;

  const due = state.due;
  state.due = new Set();

  // Every position whose value needs to be frozen before computing:
  // the due pieces themselves, plus all their neighbors.
  const involved = new Set(due);
  for (const key of due) {
    const [x, y, z] = parsePosKey(key);
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const npiece = getPiece(board, x + dx, y + dy, z + dz);
      if (npiece) involved.add(posKey(x + dx, y + dy, z + dz));
    }
  }

  const snapshotHeat = new Map();
  for (const key of involved) {
    const [x, y, z] = parsePosKey(key);
    const piece = getPiece(board, x, y, z);
    if (piece) snapshotHeat.set(key, piece.heat);
  }

  const deltas = new Map();
  for (const key of due) {
    const [x, y, z] = parsePosKey(key);
    const piece = getPiece(board, x, y, z);
    if (!piece) continue;

    const piecemass = PIECE_TYPES[piece.type].mass;
    const pieceTemp = snapshotHeat.get(key) / piecemass;

    const neighborKeys = [];
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const nKey = posKey(x + dx, y + dy, z + dz);
      if (snapshotHeat.has(nKey)) neighborKeys.push(nKey);
    }
    if (neighborKeys.length === 0) continue;

    for (const nKey of neighborKeys) {
      const [nx, ny, nz] = parsePosKey(nKey);
      const neighborPiece = getPiece(board, nx, ny, nz);
      const neighbormass = PIECE_TYPES[neighborPiece.type].mass;
      const neighborTemp = snapshotHeat.get(nKey) / neighbormass;

      const gradient = pieceTemp - neighborTemp;
      const transferred = Math.round(gradient / (HEAT_TRANSFER_DIVISOR * neighborKeys.length));
      if (transferred === 0) continue;

      deltas.set(key, (deltas.get(key) || 0) - transferred);
      deltas.set(nKey, (deltas.get(nKey) || 0) + transferred);
    }
  }

  for (const [key, delta] of deltas) {
    const [x, y, z] = parsePosKey(key);
    const piece = getPiece(board, x, y, z);
    if (piece) piece.heat += delta;
  }

  // Self-triggered (was actually due) pieces reschedule on their normal
  // urgency-based interval. Neighbors only disturbed as a side effect
  // of someone else's transfer must recheck almost immediately instead
  // — otherwise a low-urgency (near-room-temp) intermediate cell waits
  // up to HEAT_BASE ticks before its next check, and diffusion can't
  // keep pace with the boundary's constant unconditional injection,
  // so heat pools at the boundary instead of spreading inward.
  for (const key of due) {
    const [x, y, z] = parsePosKey(key);
    const piece = getPiece(board, x, y, z);
    if (!piece) continue;
    checkPhase(piece);
    scheduleNextCheck(state, board, timer, x, y, z);
  }
  for (const key of deltas.keys()) {
    if (due.has(key)) continue; // already handled above
    const [x, y, z] = parsePosKey(key);
    const piece = getPiece(board, x, y, z);
    if (!piece) continue;
    checkPhase(piece);
    cancelPending(state, timer, key);
    const id = registerCountdown(timer, 0, () => markDue(state, timer, board, x, y, z));
    state.pendingByPos.set(key, id);
  }
}

// ---------------------------------------------------------------
// Boundary injection (the only heat source/sink)
// ---------------------------------------------------------------

const FLOOR_HEAT_INJECT = 20;    // heat units added at z=0 each tick
const CEILING_HEAT_EXTRACT = 20; // heat units removed at top layer each tick

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
        state.due.add(posKey(x, y, 0));
      }
      if (top > 0) {
        const topPiece = getPiece(board, x, y, top);
        if (topPiece) {
          topPiece.heat -= CEILING_HEAT_EXTRACT;
          state.due.add(posKey(x, y, top));
        }
      }
    }
  }

  registerCountdown(timer, 1, () => applyBoundaryHeat(state, board, timer));
}

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------

/* startHeat: scans every position once to schedule its first
   urgency-based recheck, then kicks off floor/ceiling injection.
   Board must already have heat set (via seedHeat) before calling. */
export function startHeat(state, board, timer) {
  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        scheduleNextCheck(state, board, timer, x, y, z);
      }
    }
  }
  registerCountdown(timer, 1, () => applyBoundaryHeat(state, board, timer));
}
