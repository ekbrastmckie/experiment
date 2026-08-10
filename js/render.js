/* render.js
   GUI/display layer: isometric drawing of the gamespace grid to
   the canvas, plus a DOM-based window/menu overlay system.
   Reads grid state, never mutates it.

   Two independent pieces live here:
   1. Canvas renderer  — draws the 3D piece grid isometrically.
   2. Window/menu layer — real HTML/CSS elements floated on top
      of the canvas (for accessibility: screen readers, keyboard
      nav, zoom all work for free this way).

   Usage from main.js (once it exists):
     import { initRenderer, renderGrid, createWindow } from './render.js';
     initRenderer('board');
     renderGrid(grid);              // grid = gamespace.js's 3D array
     createWindow({ title: 'Stats', content: '<p>Tick: 0</p>' });
*/

// ---------------------------------------------------------------
// 1. Canvas isometric grid renderer
// ---------------------------------------------------------------

let canvas = null;
let ctx = null;

const TILE_WIDTH = 64;   // horizontal footprint of one tile, in px
const TILE_HEIGHT = 32;  // vertical footprint of one tile, in px
const TILE_DEPTH = 32;   // px shifted upward per height (z) level

// Placeholder colors until pieces.js defines the real registry.
// Unknown types render magenta so missing entries are obvious, not silent.
const PIECE_COLORS = {
  magma: '#ff4500',
  stone: '#808080',
  water: '#1e90ff',
  ice:   '#b3e5fc',
  steam: '#f5f5f5',
  air:   '#e0f7fa',
  smoke: '#616161',
  fire:  '#ff6f00'
};

export function initRenderer(canvasId) {
  canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`initRenderer: no element with id "${canvasId}"`);
  ctx = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  initWindowLayer();
}

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

// grid coords -> screen coords (standard 2:1 isometric projection)
function toScreen(x, y, z) {
  const originX = canvas.width / 2;
  const originY = 100;
  const screenX = originX + (x - y) * (TILE_WIDTH / 2);
  const screenY = originY + (x + y) * (TILE_HEIGHT / 2) - z * TILE_DEPTH;
  return { screenX, screenY };
}

/* renderGrid: draws every non-empty piece in a 3D array
   grid[x][y][z] = { type, temperature, ... }
   Draws back-to-front, bottom-to-top so nearer/higher pieces
   correctly cover farther/lower ones (painter's algorithm). */
export function renderGrid(grid) {
  if (!ctx) throw new Error('renderGrid: call initRenderer() first');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sizeX = grid.length;
  const sizeY = grid[0].length;
  const sizeZ = grid[0][0].length;

  for (let z = 0; z < sizeZ; z++) {
    const maxSum = (sizeX - 1) + (sizeY - 1);
    for (let sum = 0; sum <= maxSum; sum++) {
      for (let x = 0; x <= sum; x++) {
        const y = sum - x;
        if (x >= sizeX || y >= sizeY) continue;
        const piece = grid[x][y][z];
        if (!piece || piece.type === 'empty') continue;
        drawTile(x, y, z, piece);
      }
    }
  }
}

function drawTile(x, y, z, piece) {
  const { screenX, screenY } = toScreen(x, y, z);
  const color = PIECE_COLORS[piece.type] || '#ff00ff';

  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_HEIGHT / 2);
  ctx.lineTo(screenX + TILE_WIDTH / 2, screenY);
  ctx.lineTo(screenX, screenY + TILE_HEIGHT / 2);
  ctx.lineTo(screenX - TILE_WIDTH / 2, screenY);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
}

// ---------------------------------------------------------------
// 2. DOM window/menu overlay
// ---------------------------------------------------------------

let windowLayer = null;
let windowCount = 0;

function initWindowLayer() {
  windowLayer = document.createElement('div');
  windowLayer.id = 'render-window-layer';
  Object.assign(windowLayer.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none' // clicks pass through to canvas except on windows
  });
  document.body.appendChild(windowLayer);
}

/* createWindow: adds a draggable, closable window to the overlay.
   Returns its id so you can removeWindow(id) later. */
export function createWindow({
  title = 'Window',
  content = '',
  x = 40,
  y = 40,
  width = 240,
  closable = true
} = {}) {
  const id = `render-window-${++windowCount}`;

  const win = document.createElement('div');
  win.id = id;
  Object.assign(win.style, {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    background: '#1e1e1e',
    color: '#f0f0f0',
    border: '1px solid #444',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    fontFamily: 'sans-serif',
    fontSize: '14px',
    pointerEvents: 'auto',
    overflow: 'hidden'
  });

  const header = document.createElement('div');
  header.textContent = title;
  Object.assign(header.style, {
    background: '#333',
    padding: '6px 8px',
    cursor: 'move',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    userSelect: 'none'
  });

  if (closable) {
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7'; // ×
    closeBtn.setAttribute('aria-label', `Close ${title}`);
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      color: '#f0f0f0',
      fontSize: '16px',
      cursor: 'pointer',
      lineHeight: '1'
    });
    closeBtn.addEventListener('click', () => removeWindow(id));
    header.appendChild(closeBtn);
  }

  const body = document.createElement('div');
  body.innerHTML = content;
  body.style.padding = '8px';

  win.appendChild(header);
  win.appendChild(body);
  makeDraggable(win, header);
  windowLayer.appendChild(win);

  return id;
}

export function removeWindow(id) {
  const win = document.getElementById(id);
  if (win) win.remove();
}

function makeDraggable(win, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const start = (clientX, clientY) => {
    dragging = true;
    offsetX = clientX - win.offsetLeft;
    offsetY = clientY - win.offsetTop;
  };
  const move = (clientX, clientY) => {
    if (!dragging) return;
    win.style.left = `${clientX - offsetX}px`;
    win.style.top = `${clientY - offsetY}px`;
  };
  const end = () => { dragging = false; };

  handle.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  document.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  document.addEventListener('mouseup', end);

  handle.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    move(t.clientX, t.clientY);
  }, { passive: true });
  document.addEventListener('touchend', end);
}

// ---------------------------------------------------------------
// TEMP: test grid, for verifying the renderer before gamespace.js
// exists. Delete this function (and callers) once gamespace.js
// provides real grid data.
// ---------------------------------------------------------------
export function generateTestGrid(size = 4) {
  const types = ['stone', 'water', 'magma', 'air'];
  const grid = [];
  for (let x = 0; x < size; x++) {
    grid[x] = [];
    for (let y = 0; y < size; y++) {
      grid[x][y] = [];
      for (let z = 0; z < size; z++) {
        grid[x][y][z] = { type: types[(x + y + z) % types.length], temperature: 20 };
      }
    }
  }
  return grid;
}
