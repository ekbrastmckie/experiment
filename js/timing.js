/* timing.js
   Generic tick/countdown engine. Deliberately piece-agnostic — knows
   nothing about pieces, only ticks and countdowns. Same engine drives
   real-time or turn-based modes depending on what calls tick().

   Exports:
     TICK_MS               — real-time tick duration in ms (25).
     createTimer()          — new timer state. Pass this into every
       other function below; nothing here is global.
     registerCountdown(timer, ticks, callback)
                             — schedules callback to fire in `ticks`
       ticks from now (0 = fires on the very next tick() call).
       Returns an id you can pass to cancelCountdown.
     cancelCountdown(timer, id)
                             — cancels a pending countdown before it
       fires. Instant — takes effect immediately, no ticks consumed.
       Returns true if something was cancelled, false if the id
       didn't exist (already fired or already cancelled).
     tick(timer)             — advances time by one tick, resolving
       (in registration order) every countdown whose fire-tick has
       been reached.
     advanceTicks(timer, n)  — convenience: calls tick() n times in a
       row. For custom early-stopping behavior (e.g. "stop advancing
       once the player's move resolves"), call tick() directly in a
       loop instead — timing.js has no concept of "player", so it
       can't build that stopping rule in itself.
     startRealtime(timer, onTick) / stopRealtime(timer)
                             — real-time driver: calls tick() every
       TICK_MS automatically via setInterval, optionally invoking
       onTick(timer) after each tick (for triggering a render, etc).
       Turn-based mode just never calls this — it drives tick()
       itself instead (e.g. on player input, or advanceTicks()).

   Imports: none. No dependencies on any other file — this is
   intentional (see design-doc-v0.10.md, Section 3).

   Used by: physics.js and alive.js will import from here to
   register countdowns for piece moves. timing.js never imports
   from them — that direction would create a circular dependency.

   ---------------------------------------------------------------
   Design notes (decided in chat, kept here for continuity):

   - Countdowns are stored by absolute "fire tick" (currentTick +
     ticks), not as a per-item decrementing counter — comparing to
     an absolute number avoids touching every pending countdown on
     every single tick just to keep it accurate.
   - Pending countdowns live in a min-heap keyed by fire-tick, so
     finding "what's due right now" doesn't require scanning every
     pending countdown — cost scales with what's due, not with the
     total number pending. This matters once the board is large and
     most pending moves are slow/far-future (stone, plants) with
     only a few fast/near-future ones (animals).
   - Countdowns sharing the exact same fire-tick are grouped into one
     heap node, holding an ordered list of moves. This is how ties
     are broken: moves resolve in registration order among anything
     sharing a tick, per the design decision that pending moves are
     conceptually ordered by when they were made.
   - Cancellation is a plain, instant primitive — not a special move
     type, and not something that costs reaction time. A caller that
     wants "pressing a new direction replaces the old move" just
     calls cancelCountdown() then registerCountdown() back to back.
     Internally, cancelling just removes the move from its node's
     list. If that empties the node, the node is abandoned (left in
     the heap, but forgotten from the lookup maps) rather than
     surgically removed from the middle of the heap array — it gets
     silently discarded whenever it naturally reaches the top later.
     This keeps cancellation O(1)-ish instead of needing an
     arbitrary-position heap removal.
   - Ticks are atomic: tick() runs every countdown due that tick to
     completion before returning. There's no partial-tick state.
   - Pausing isn't a concept timing.js needs to know about — it's
     just "whoever is calling tick() stops calling it." Real-time
     mode achieves this via stopRealtime(); turn-based mode achieves
     it by simply not calling tick() until the next input.
   - Real-time tick duration: 25ms. Chosen so that whole-tick speed
     ratios can land close to their real-world proportions (falcon
     dive = 2 ticks/position, sprint = 4 ticks, jog = 20 ticks,
     stealth crawl = 40-80 ticks) while staying well inside a
     plausible per-tick compute budget.
*/

export const TICK_MS = 25;

// ---------------------------------------------------------------
// Timer state
// ---------------------------------------------------------------

/* createTimer: fresh, independent timer state. Nothing in this
   module is stored outside what you get back here, so you can run
   multiple independent timers if you ever need to (e.g. a paused
   preview simulation alongside the real one). */
export function createTimer() {
  return {
    currentTick: 0,
    heap: [],                    // array of { fireTick, moves: [...] } nodes
    fireTickToNode: new Map(),   // fireTick -> live node, for insert-time collision checks
    moveIdToNode: new Map(),     // moveId -> node, for cancel lookups
    nextId: 1,
    intervalHandle: null         // used by startRealtime/stopRealtime
  };
}

// ---------------------------------------------------------------
// Min-heap helpers (private — operate on a plain array of nodes,
// ordered by node.fireTick, smallest on top)
// ---------------------------------------------------------------

function siftUp(heap, index) {
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    if (heap[parentIndex].fireTick <= heap[index].fireTick) break;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function siftDown(heap, index) {
  const length = heap.length;
  while (true) {
    const left = index * 2 + 1;
    const right = index * 2 + 2;
    let smallest = index;
    if (left < length && heap[left].fireTick < heap[smallest].fireTick) smallest = left;
    if (right < length && heap[right].fireTick < heap[smallest].fireTick) smallest = right;
    if (smallest === index) break;
    [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
    index = smallest;
  }
}

/* popMin: removes and returns the smallest (soonest-firing) node.
   Standard heap removal: move the last element to the root, shrink
   the array, then sift it down to restore heap order. */
function popMin(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    siftDown(heap, 0);
  }
  return top;
}

// ---------------------------------------------------------------
// Countdown registration / cancellation
// ---------------------------------------------------------------

/* registerCountdown: schedules callback to fire `ticks` ticks from
   now. ticks must be a non-negative integer (0 fires on the very
   next tick() call). Returns an id for cancelCountdown. */
export function registerCountdown(timer, ticks, callback) {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`registerCountdown: ticks must be a non-negative integer, got ${ticks}`);
  }

  const fireTick = timer.currentTick + ticks;
  const id = timer.nextId++;
  const move = { id, callback };

  let node = timer.fireTickToNode.get(fireTick);
  if (!node) {
    node = { fireTick, moves: [] };
    timer.fireTickToNode.set(fireTick, node);
    timer.heap.push(node);
    siftUp(timer.heap, timer.heap.length - 1);
  }
  node.moves.push(move);
  timer.moveIdToNode.set(id, node);

  return id;
}

/* cancelCountdown: cancels a pending countdown before it fires.
   Instant — no ticks consumed. Returns true if something was
   cancelled, false if the id doesn't exist (already fired, already
   cancelled, or never valid). */
export function cancelCountdown(timer, id) {
  const node = timer.moveIdToNode.get(id);
  if (!node) return false;

  const index = node.moves.findIndex(move => move.id === id);
  if (index === -1) return false; // shouldn't happen, but stay safe

  node.moves.splice(index, 1);
  timer.moveIdToNode.delete(id);

  // If this emptied the node, forget it from the lookup map so a
  // future registerCountdown() at this same fireTick starts a fresh
  // node rather than reusing this dying one. The old node stays
  // physically in the heap array — harmless — and gets silently
  // discarded by tick() once it naturally reaches the top.
  if (node.moves.length === 0) {
    timer.fireTickToNode.delete(node.fireTick);
  }

  return true;
}

// ---------------------------------------------------------------
// Advancing time
// ---------------------------------------------------------------

/* tick: advances time by one tick, then resolves (in registration
   order) every countdown whose fire-tick has now been reached.
   Runs to completion before returning — ticks are atomic. */
export function tick(timer) {
  timer.currentTick += 1;

  while (timer.heap.length > 0 && timer.heap[0].fireTick <= timer.currentTick) {
    const node = popMin(timer.heap);
    // An emptied (cancelled-out) node is discarded here, silently.
    for (const move of node.moves) {
      // Clean up the id lookup before invoking the callback, so a
      // fired move's id is no longer cancellable (and so a callback
      // that itself registers/cancels things can't see stale state).
      timer.moveIdToNode.delete(move.id);
      move.callback();
    }
  }
}

/* advanceTicks: convenience for calling tick() n times in a row.
   For custom early-stopping behavior, call tick() directly in your
   own loop instead — timing.js has no concept of what should cause
   an early stop. */
export function advanceTicks(timer, n) {
  for (let i = 0; i < n; i++) {
    tick(timer);
  }
}

// ---------------------------------------------------------------
// Real-time driver
// ---------------------------------------------------------------

/* startRealtime: begins calling tick() automatically every TICK_MS.
   Optional onTick(timer) runs after each tick (e.g. to trigger a
   render). Calling this while already running restarts the
   interval. */
export function startRealtime(timer, onTick) {
  stopRealtime(timer);
  timer.intervalHandle = setInterval(() => {
    tick(timer);
    if (onTick) onTick(timer);
  }, TICK_MS);
}

/* stopRealtime: stops the automatic tick() calls started by
   startRealtime(). Safe to call even if it isn't running. This is
   "pause" — timing.js has no separate pause concept beyond this. */
export function stopRealtime(timer) {
  if (timer.intervalHandle !== null) {
    clearInterval(timer.intervalHandle);
    timer.intervalHandle = null;
  }
}
