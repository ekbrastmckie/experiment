/* main.js
   Entry point. Creates the gamespace grid, starts the timing engine,
   and wires physics/creatures/render systems to it. The only file
   that imports and coordinates all the others. */
import { initRenderer, renderGrid, generateTestGrid, createWindow } from './render.js';

initRenderer('board');
renderGrid(generateTestGrid());
createWindow({ title: 'Test Window', content: '<p>It works.</p>' });
