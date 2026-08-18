/* board.js v0.16
   Synced to: design-doc v0.11

   The grid itself, and the registry of what piece types exist.
   Pure data — no rendering, no tick logic, no rules. No imports.

   Piece shape: { type, heat }
   heat is computed at creation from the type's default temperature
   and mass (heat = temperature * mass). Temperature is never
   stored — derive it as heat / PIECE_TYPES[type].mass wherever
   needed.

   Exports:
     PIECE_TYPES        — registry: { typeName: { color, temperature,
                           mass, phase, momentum } }
     isValidType(type)  — bool, true if type exists in PIECE_TYPES
     setBoard(sizeX, sizeY, sizeZ) — new 3D grid, semi-random layered
       fill (see below). Every piece is { type, heat }.
     getPiece(board, x, y, z) — piece at that position, or null if
       out of bounds.
     setPiece(board, x, y, z, piece) — writes a piece at that
       position. Returns true on success, false if out of bounds.

   LAYER SCHEME (setBoard):
   For each (x, y) column, bottom to top:
     - magma: 1 or 2 cells, chosen randomly per column
     - stone: 2 cells
     - water: 2 cells
     - air: fills the remainder up to sizeZ
   If sizeZ is too small to fit magma+stone+water, the column is
   truncated bottom-up in that same priority order and air is
   skipped entirely.
*/

// ---------------------------------------------------------------
// Piece type registry
// ---------------------------------------------------------------
// color: rgba string, used by render.js for all shading (top/side
//   faces derive their shade from this at draw time).
// temperature: default starting temperature for a freshly created
//   piece of this type, in arbitrary sim units.
// mass: doubles as thermal mass in physics.js's
//   heat math, and as the gravity comparison value.
// phase: 'solid' | 'liquid' | 'gas' | 'none' (space only — not real
//   matter, so it doesn't have a physical phase).
// momentum: default starting momentum. Not yet consumed anywhere —
//   added preemptively for force.js's planned momentum mechanic.

export const PIECE_TYPES = {
  space: { color: 'rgba(0,0,0,0)',         temperature: 0, mass: 0,  phase: 'none',   momentum: 0 },
  magma: { color: 'rgba(255,69,0,0.8)',    temperature: 90,   mass: 30, phase: 'liquid', momentum: 0 },
  stone: { color: 'rgba(128,128,128,1.0)', temperature: 3,    mass: 25, phase: 'solid',  momentum: 0 },
  ice:   { color: 'rgba(179,229,252,0.6)', temperature: -10,  mass: 9,  phase: 'solid',  momentum: 0 },
  water: { color: 'rgba(30,144,255,0.2)',  temperature: 3,    mass: 10, phase: 'liquid', momentum: 0 },
  steam: { color: 'rgba(245,245,245,0.3)', temperature: 20,   mass: 1,  phase: 'gas',    momentum: 0 },
  air:   { color: 'rgba(224,247,250,0.1)', temperature: 3,    mass: 2,  phase: 'gas',    momentum: 0 },
  smoke: { color: 'rgba(97,97,97,0.5)',    temperature: 20,   mass: 1,  phase: 'gas',    momentum: 0 },
  fire:  { color: 'rgba(255,111,0,0.4)',   temperature: 40,   mass: 1,  phase: 'gas',    momentum: 0 }
};

export function isValidType(type) {
  return Object.prototype.hasOwnProperty.call(PIECE_TYPES, type);
}

// ---------------------------------------------------------------
// Grid creation and access
// ---------------------------------------------------------------

function makePiece(type) {
  const info = PIECE_TYPES[type];
  return {
    type,
    heat: info.temperature * info.mass
  };
}

/* columnLayers: builds the bottom-to-top type sequence for one
   column, truncated to sizeZ if the column doesn't fully fit. */
function columnLayers(sizeZ) {
  const magmaCount = Math.random() < 0.5 ? 1 : 2;
  const sequence = [];
  for (let i = 0; i < magmaCount; i++) sequence.push('magma');
  for (let i = 0; i < 2; i++) sequence.push('stone');
  for (let i = 0; i < 2; i++) sequence.push('water');
  while (sequence.length < sizeZ) sequence.push('air');
  return sequence.slice(0, sizeZ);
}

/* setBoard: builds a sizeX * sizeY * sizeZ grid using the layered
   landscape scheme described in the file header. This is the only
   board-builder now — createBoard (v0.14 and earlier) is removed. */
export function setBoard(sizeX, sizeY, sizeZ) {
  const board = [];
  for (let x = 0; x < sizeX; x++) {
    board[x] = [];
    for (let y = 0; y < sizeY; y++) {
      const layers = columnLayers(sizeZ);
      board[x][y] = [];
      for (let z = 0; z < sizeZ; z++) {
        board[x][y][z] = makePiece(layers[z]);
      }
    }
  }
  return board;
}

function inBounds(board, x, y, z) {
  return (
    x >= 0 && x < board.length &&
    y >= 0 && y < board[0].length &&
    z >= 0 && z < board[0][0].length
  );
}

export function getPiece(board, x, y, z) {
  if (!inBounds(board, x, y, z)) return null;
  return board[x][y][z];
}

export function setPiece(board, x, y, z, piece) {
  if (!inBounds(board, x, y, z)) return false;
  board[x][y][z] = piece;
  return true;
}
