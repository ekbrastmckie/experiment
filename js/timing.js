/* timing.js
   Generic tick/countdown engine. Deliberately piece-agnostic — knows
   nothing about pieces, only ticks and countdowns. Same engine drives
   real-time or turn-based modes depending on what calls tick().

   Exports (planned):
     TODO — createTimer() or similar: sets up tick state
     TODO — registerCountdown(ticks, callback): schedules a callback
       to fire when its countdown reaches 0
     TODO — tick(): advances time by one tick, resolves any
       countdowns that hit 0

   Imports: none. No dependencies on any other file — this is
   intentional (see design-doc-v0.10.md, Section 3).

   Used by: physics.js and alive.js will import from here to
   register countdowns for piece moves. timing.js never imports
   from them — that direction would create a circular dependency.
*/
