/* render.js
   GUI/display layer: isometric drawing of the board grid to
   the canvas, plus a DOM-based window/menu overlay system.
   Reads grid state, never mutates it.

   Two independent pieces live here:
   1. Canvas renderer  — draws the 3D piece grid isometrically.
   2. Window/menu layer — real HTML/CSS elements floated on top
      of the canvas (for accessibility: screen readers, keyboard
      nav, zoom all work for free this way).

   Colors come from board.js's PIECE_TYPES registry (single source
   of truth for what a piece type looks like) — render.js no longer
   keeps its own duplicate color table.

   Usage from main.js:
     import { initRenderer, renderGrid, createWindow } from './render.js';
     import { createBoard } from './board.js';
     initRenderer('board');
     renderGrid(createBoard(8, 8, 8, 'stone'));
     createWindow({ title: 'Stats', content: '<p>Tick: 0</p>' });
*/

import { PIECE_TYPES } from './board.js';

// ---------------------------------------------------------------
// 1. Canvas isometric grid renderer
// ---------------------------------------------------------------

let canvas = null;
let ctx = null;

const TILE_WIDTH = 64;   // horizontal footprint of one tile, in px
const TILE_HEIGHT = 32;  // vertical footprint of one tile, in px
const TILE_DEPTH = 32;   // px shifted upward per height (z) level

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

// grid coords -> screen coords, BEFORE centering/scaling.
// (x - y) and (x + y) is the standard 2:1 isometric projection.
function toIsoUnscaled(x, y, z) {
  const screenX = (x - y) * (TILE_WIDTH / 2);
  const screenY = (x + y) * (TILE_HEIGHT / 2) - z * TILE_DEPTH;
  return { screenX, screenY };
}

// Finds the bounding box (in unscaled iso space) of a sizeX*sizeY*sizeZ
// grid by checking all 8 corners of the cuboid — the projection is
// linear per-axis, so extremes always land on a corner.
function computeIsoBounds(sizeX, sizeY, sizeZ) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [0, sizeX]) {
    for (const y of [0, sizeY]) {
      for (const z of [0, sizeZ]) {
        const { screenX, screenY } = toIsoUnscaled(x, y, z);
        minX = Math.min(minX, screenX);
        maxX = Math.max(maxX, screenX);
        minY = Math.min(minY, screenY);
        maxY = Math.max(maxY, screenY);
      }
    }
  }
  // pad by one tile's footprint since tiles are drawn as diamonds
  // centered on these coordinates, not points. maxY gets extra
  // padding equal to TILE_DEPTH since each piece now draws as a
  // full cube — its side faces hang down below the top diamond,
  // so the lowest layer's cube bottoms need room too.
  return {
    minX: minX - TILE_WIDTH / 2,
    maxX: maxX + TILE_WIDTH / 2,
    minY: minY - TILE_HEIGHT / 2,
    maxY: maxY + TILE_HEIGHT / 2 + TILE_DEPTH
  };
}

const FIT_PADDING = 0.9;  // leave a 10% margin around the grid
const MAX_SCALE = 4;      // don't blow tiles up absurdly for tiny grids

/* renderGrid: draws every piece in a 3D board array
   board[x][y][z] = { type, temperature, ... }
   Draws back-to-front, bottom-to-top so nearer/higher pieces
   correctly cover farther/lower ones (painter's algorithm).
   Auto-fits and centers the whole grid to the current canvas size,
   however large or small the grid or canvas turn out to be.
   A piece whose type isn't in board.js's PIECE_TYPES registry
   renders magenta, so a bad/missing entry is obvious, not silent. */
export function renderGrid(board) {
  if (!ctx) throw new Error('renderGrid: call initRenderer() first');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sizeX = board.length;
  const sizeY = board[0].length;
  const sizeZ = board[0][0].length;

  const bounds = computeIsoBounds(sizeX, sizeY, sizeZ);
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  const scale = Math.min(
    (canvas.width / boundsWidth) * FIT_PADDING,
    (canvas.height / boundsHeight) * FIT_PADDING,
    MAX_SCALE
  );

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);
  ctx.lineWidth = 1 / scale; // keep tile outlines crisp at any scale

  for (let z = 0; z < sizeZ; z++) {
    const maxSum = (sizeX - 1) + (sizeY - 1);
    for (let sum = 0; sum <= maxSum; sum++) {
      for (let x = 0; x <= sum; x++) {
        const y = sum - x;
        if (x >= sizeX || y >= sizeY) continue;
        const piece = board[x][y][z];
        if (!piece) continue;
        drawTile(x, y, z, piece);
      }
    }
  }

  ctx.restore();
}

// Multiplies a '#rrggbb' color by a brightness factor (e.g. 0.6 = darker,
// 1.0 = unchanged) to fake directional light across a cube's three
// visible faces. Values are clamped so this never over/underflows.
function shadeColor(hex, factor) {
  const r = Math.round(Math.min(255, parseInt(hex.slice(1, 3), 16) * factor));
  const g = Math.round(Math.min(255, parseInt(hex.slice(3, 5), 16) * factor));
  const b = Math.round(Math.min(255, parseInt(hex.slice(5, 7), 16) * factor));
  return `rgb(${r}, ${g}, ${b})`;
}

// Draws one piece as a full cube: a top face (lit brightest, as if
// from directly above) plus left and right side faces (progressively
// darker, to sell the 3D shape). All three faces share the same
// base color, just shaded differently.
function drawTile(x, y, z, piece) {
  const { screenX, screenY } = toIsoUnscaled(x, y, z);
  const typeInfo = PIECE_TYPES[piece.type];
  const base = typeInfo ? typeInfo.color : '#ff00ff';

  // Top face's four corners (N, E, S, W) and their counterparts one
  // tile-depth lower, which form the bottom edge of the side faces.
  const nTop = { x: screenX, y: screenY - TILE_HEIGHT / 2 };
  const eTop = { x: screenX + TILE_WIDTH / 2, y: screenY };
  const sTop = { x: screenX, y: screenY + TILE_HEIGHT / 2 };
  const wTop = { x: screenX - TILE_WIDTH / 2, y: screenY };
  const eBottom = { x: eTop.x, y: eTop.y + TILE_DEPTH };
  const sBottom = { x: sTop.x, y: sTop.y + TILE_DEPTH };
  const wBottom = { x: wTop.x, y: wTop.y + TILE_DEPTH };

  ctx.strokeStyle = 'rgba(0,0,0,0.25)';

  // Left face: W -> S -> S(bottom) -> W(bottom)
  ctx.beginPath();
  ctx.moveTo(wTop.x, wTop.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(sBottom.x, sBottom.y);
  ctx.lineTo(wBottom.x, wBottom.y);
  ctx.closePath();
  ctx.fillStyle = shadeColor(base, 0.55);
  ctx.fill();
  ctx.stroke();

  // Right face: S -> E -> E(bottom) -> S(bottom)
  ctx.beginPath();
  ctx.moveTo(sTop.x, sTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.lineTo(eBottom.x, eBottom.y);
  ctx.lineTo(sBottom.x, sBottom.y);
  ctx.closePath();
  ctx.fillStyle = shadeColor(base, 0.75);
  ctx.fill();
  ctx.stroke();

  // Top face: N -> E -> S -> W (drawn last so its edges sit cleanly
  // over the tops of the side faces)
  ctx.beginPath();
  ctx.moveTo(nTop.x, nTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(wTop.x, wTop.y);
  ctx.closePath();
  ctx.fillStyle = shadeColor(base, 1.0);
  ctx.fill();
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
