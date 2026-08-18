/* main.js v0.16
   Entry point. Creates a real board (via board.js), fills it
   randomly (via physics.js), starts gravity sorting it, and drives
   real-time ticking + rendering so the sort is visible live.
*/
import { initRenderer, renderGrid } from './render.js';
import { setBoard } from './board.js';
import { createTimer, tick } from './timing.js';
import { createHeatState, seedHeat, startHeat, processDueHeat } from './heat.js';
import { createForceState, startForce, processDueForce } from './force.js'

const BOARD_SIZE = 8;

initRenderer('board');

const board = setBoard(BOARD_SIZE, BOARD_SIZE, BOARD_SIZE);
seedHeat(board);

const timer = createTimer();
const heatState = createHeatState();
const forceState = createForceState();
startHeat(heatState, board, timer);
startForce(forceState, board, timer);

renderGrid(board);

setInterval(() => {
  tick(timer);
  processDueHeat(heatState, board, timer);
  processDueForce(forceState, board, timer);
  
  renderGrid(board);
}, 25);