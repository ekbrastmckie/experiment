// ---- Gamespace: 8x8x8 grid, every position IS a piece ----
const SIZE = 8;

// Piece type colors (top, left-face, right-face) for basic shading
const PIECE_COLORS = {
  magma: ['#ff5a1f', '#cc4519', '#992e14'],
  stone: ['#9a9a92', '#7a7a72', '#5a5a54'],
  water: ['#3aa0ff', '#2d7fcc', '#205e99'],
  air:   ['#e6f1fb', '#c9dced', '#adc4de'],
};

// grid[x][y][z] = { type, temperature }
function createGrid() {
  const grid = [];
  for (let x = 0; x < SIZE; x++) {
    grid[x] = [];
    for (let y = 0; y < SIZE; y++) {
      grid[x][y] = [];
      for (let z = 0; z < SIZE; z++) {
        grid[x][y][z] = makePiece(z);
      }
    }
  }
  return grid;
}

// Layered placeholder population, just to prove the structure + renderer work.
// Real Earth-formation placement rules come later.
function makePiece(z) {
  let type;
  if (z <= 2) type = 'magma';
  else if (z <= 4) type = 'stone';
  else if (z <= 6) type = 'water';
  else type = 'air';

  const temperature = type === 'magma' ? 1200 : type === 'stone' ? 400 : type === 'water' ? 20 : 15;
  return { type, temperature };
}

const grid = createGrid();

// ---- Isometric rendering ----
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const TILE_W = 28;
const TILE_H = 14;
const CUBE_H = 18;

canvas.width = 900;
canvas.height = 620;

function toScreen(x, y, z) {
  const originX = canvas.width / 2;
  const originY = 70;
  const sx = originX + (x - y) * (TILE_W / 2);
  const sy = originY + (x + y) * (TILE_H / 2) - z * CUBE_H;
  return { sx, sy };
}

function drawCube(x, y, z, type) {
  const { sx, sy } = toScreen(x, y, z);
  const [top, left, right] = PIECE_COLORS[type];
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  // Top face
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
  ctx.fill();

  // Left face
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(sx - hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx, sy + hh + CUBE_H);
  ctx.lineTo(sx - hw, sy + CUBE_H);
  ctx.closePath();
  ctx.fill();

  // Right face
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx, sy + hh + CUBE_H);
  ctx.lineTo(sx + hw, sy + CUBE_H);
  ctx.closePath();
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Collect all cubes and sort back-to-front (painter's algorithm)
  const cubes = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        cubes.push({ x, y, z, piece: grid[x][y][z] });
      }
    }
  }
  cubes.sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));

  for (const c of cubes) {
    drawCube(c.x, c.y, c.z, c.piece.type);
  }
}

render();
