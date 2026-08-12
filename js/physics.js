/* physics.js
   Rules for inert matter: heat transfer, phase transitions,
   gravity/density (later). Runs on tick, reads and mutates piece
   state in the board grid.

   Exports (planned):
     TODO — a per-tick update function (e.g. updatePhysics(board)):
       walks the board (or registered pieces) and applies heat
       transfer / phase transition rules
     TODO — phase transition thresholds per piece type (e.g. water
       boils above X, freezes below Y)

   Imports (planned):
     from board.js — PIECE_TYPES, getPiece, setPiece (reads/writes
       piece state, references type registry for thresholds)
     from timing.js — registers countdowns for moves that resolve
       over multiple ticks, rather than instantly

   Depends on: board.js (built), timing.js (stub — not yet built).
   Cannot be meaningfully written until timing.js has real exports
   to register against.
*/
