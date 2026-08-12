/* board.js
   The grid itself, and the registry of what piece types exist.
   Pure data — no rendering, no tick logic, no rules.

   Exports:
     PIECE_TYPES        — registry object: { typeName: { color, temperature } }
     isValidType(type)  — bool, true if type exists in PIECE_TYPES
     createBoard(sizeX, sizeY, sizeZ, fillType) — new 3D grid, every
       cell filled with a piece of fillType. fillType is REQUIRED —
       there is no default, since "every position is a piece" means
       there's no safe type to assume on someone's behalf.
     getPiece(board, x, y, z) — returns the piece at that position,
       or null if the position is out of bounds.
     setPiece(board, x, y, z, piece) — writes a piece at that position.
       Returns true on success, false if out of bounds.

   Imports: none. This file has no dependencies on any other file.

   Piece shape: { type, temperature }
   (matches what render.js and physics.js already expect)
*/

// ---------------------------------------------------------------
// Piece type registry
// ---------------------------------------------------------------
// color: used by render.js.
// temperature: default starting temperature for a freshly created
// piece of this type, in arbitrary sim units (not real-world °C/°F —
// exact scale to be decided when physics.js defines melting/freezing
// thresholds).

export const PIECE_TYPES = {
  space: { color: '#000000', temperature: -273 }, // pre-formation emptiness
  magma: { color: '#ff4500', temperature: 1200 },
  stone: { color: '#808080', temperature: 20 },
  ice:   { color: '#b3e5fc', temperature: -10 },
  water: { color: '#1e90ff', temperature: 15 },
  steam: { color: '#f5f5f5', temperature: 110 },
  air:   { color: '#e0f7fa', temperature: 20 },
  smoke: { color: '#616161', temperature: 60 },
  fire:  { color: '#ff6f00', temperature: 600 }
};

export function isValidType(type) {
  return Object.prototype.hasOwnProperty.call(PIECE_TYPES, type);
}

// ---------------------------------------------------------------
// Grid creation and access
// ---------------------------------------------------------------

/* createBoard: builds a sizeX * sizeY * sizeZ grid, every cell
   filled with { type: fillType, temperature: <that type's default> }.
   fillType must be a valid registered type — no fallback default,
   the caller must choose explicitly every time. */
export function createBoard(sizeX, sizeY, sizeZ, fillType) {
  if (!isValidType(fillType)) {
    throw new Error(`createBoard: "${fillType}" is not a registered piece type`);
  }

  const board = [];
  for (let x = 0; x < sizeX; x++) {
    board[x] = [];
    for (let y = 0; y < sizeY; y++) {
      board[x][y] = [];
      for (let z = 0; z < sizeZ; z++) {
        board[x][y][z] = {
          type: fillType,
          temperature: PIECE_TYPES[fillType].temperature
        };
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
