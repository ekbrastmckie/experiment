/* timing.js
   Generic tick/countdown engine. Knows nothing about pieces —
   just advances ticks and fires registered callbacks when their
   countdown hits zero. Same engine drives real-time or turn-based
   modes depending on what calls tick(). */
