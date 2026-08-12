/* main.js
   Entry point. Creates the board and hands it to the renderer.
   The only file that imports and coordinates all the others.

   For now: an 8x8x8 board, every cell filled with 'stone', just
   to confirm board.js -> render.js -> canvas all work together.
   This is NOT the real starting state (the design doc calls for
   filling with 'space' once physics.js/formation rules exist) —
   it's a visible placeholder so the wiring can be checked by eye. */
import { initRenderer, renderGrid, createWindow } from './render.js';
import { createBoard } from './board.js';

initRenderer('board');

const board = createBoard(8, 8, 8, 'stone');
renderGrid(board);

createWindow({ title: 'Test Window', content: '<p>It works.</p>' });
