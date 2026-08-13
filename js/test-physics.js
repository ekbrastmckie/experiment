/* test-physics.js
   Standalone Node test for physics.js + timing.js, same pattern as
   test-board.js. Run with: node test-physics.js

   What it checks:
   1. A randomly-filled column settles into density order (bottom =
      densest = magma, top = least dense = space) after enough ticks.
   2. Along the way, prints periodic snapshots so you can SEE pieces
      sinking/rising over ticks, not just the final state.
*/

import { createBoard, PIECE_TYPES } from './board.js';
import { createTimer, tick } from './timing.js';
import { DENSITY, createPhysicsState, startGravity } from './physics.js';

const TYPES = ['space', 'air', 'water', 'stone', 'magma'];
const HEIGHT = 8;

// --- build a single-column board (1x1xHEIGHT), filled randomly ---
const board = createBoard(1, 1, HEIGHT, 'space');
for (let z = 0; z < HEIGHT; z++) {
  const type = TYPES[Math.floor(Math.random() * TYPES.length)];
  board[0][0][z] = { type, temperature: PIECE_TYPES[type].temperature };
}

function printColumn(label) {
  const types = [];
  for (let z = HEIGHT - 1; z >= 0; z--) types.push(board[0][0][z].type);
  console.log(`${label}: [top] ${types.join(' > ')} [bottom]`);
}

console.log('--- Starting column (random) ---');
printColumn('tick 0');

const timer = createTimer();
const physicsState = createPhysicsState();
startGravity(physicsState, board, timer);

const MAX_TICKS = 300;
let settled = false;
for (let t = 1; t <= MAX_TICKS; t++) {
  tick(timer);
  if (t % 25 === 0 || t === MAX_TICKS) printColumn(`tick ${t}`);

  if (physicsState.pendingByPos.size === 0) {
    console.log(`\nSettled after ${t} ticks (no pending falls remain).`);
    settled = true;
    break;
  }
}

console.log('\n--- Final column ---');
printColumn('final');

// --- verify: density should be non-increasing from bottom to top ---
let sorted = true;
for (let z = 1; z < HEIGHT; z++) {
  const below = DENSITY[board[0][0][z - 1].type];
  const here = DENSITY[board[0][0][z].type];
  if (here > below) sorted = false;
}

console.log(`\nSettled within ${MAX_TICKS} ticks: ${settled ? 'YES' : 'NO'}`);
console.log(`Sorted bottom(dense) -> top(light): ${sorted ? 'PASS' : 'FAIL'}`);

if (!settled || !sorted) process.exitCode = 1;
