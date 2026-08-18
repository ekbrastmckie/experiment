/* life.js v0.14
   Behavior and decision-making for living pieces. Separate from
   physics.js because living-piece logic (choices, goals) is a
   different kind of complexity than inert-matter rules.

   Likely to stay small/near-empty for a while — no living piece
   types are defined yet. Could fold into physics.js later if it
   never grows (easy to merge, harder to un-merge, so kept
   separate for now).

   Exports (planned):
     TODO — a per-tick update function for living pieces, once
       living piece types and their goals/choices are defined

   Imports (planned):
     from board.js — PIECE_TYPES, getPiece, setPiece
     from timing.js — registers countdowns for moves, same pattern
       as physics.js

   Depends on: board.js (built), timing.js (stub — not yet built).
   Written after physics.js so it can reuse established patterns.
*/
