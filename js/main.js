/* main.js
   Entry point. Creates a real board (via board.js), fills it
   randomly (via physics.js), starts gravity sorting it, and drives
   real-time ticking + rendering so the sort is visible live.
*/
import { initRenderer, renderGrid } from './render.js';
import { createBoard } from './board.js';
import { createTimer, startRealtime } from './timing.js';
import { createPhysicsState, startGravity, startHeat, fillRandom } from './physics.js';

const BOARD_SIZE = 8;

initRenderer('board');

const board = createBoard(BOARD_SIZE, BOARD_SIZE, BOARD_SIZE, 'space');
fillRandom(board);

const timer = createTimer();
const physicsState = createPhysicsState();
startGravity(physicsState, board, timer);
startHeat(physicsState, board, timer);

renderGrid(board); // initial paint, before the first tick

startRealtime(timer, () => {
  renderGrid(board);
});
