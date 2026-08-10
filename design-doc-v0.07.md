# Design Doc v0.07

Status: Living document. This captures everything decided/discussed so far. Sections marked (OPEN) are unresolved and need more input before they can be built.

---

## 1. Core Concept

A simulation game modeled after chess in terminology, but behaving more like Conway's Game of Life: instead of alternating turns, every piece evolves according to its own timing, and the board's state emerges from many pieces acting semi-independently over time.

---

## 2. Gamespace (the board)

- A cubic board with positions along rank, file, and vertical (height) dimensions.
- Starting reference scale: 8×8×8 (512 positions).
- Target scalable size: 64×64×64 (262,144 positions) or larger.
- **Key rule: every position IS a piece.** There is no separate "square" category distinct from "piece" — the board is made entirely of pieces. Since each piece is itself a position, no two pieces can occupy the same position; occupying and being are the same act.
- In chess terms, "positions" and "pieces" fall into a single unified category: piece.

---

## 3. Gametime (the timing system)

- Time advances in **ticks**.
- Pieces may have one or more available **moves** (analogous to chess moves).
- Each move has a **countdown** — a number of ticks before it resolves.
- Each tick, any move whose countdown reaches 0 executes/resolves.
- This replaces chess's alternating-turn structure with an "everyone moves at once, but at different speeds" model — a fast piece (e.g. water) might resolve moves every tick; a slow piece (e.g. stone) might take several ticks per move.
- **Design goal:** the same timing system should support toggling between:
  - **Real-time** — ticks advance automatically on a timer.
  - **Turn-based** — ticks advance on player input/step.
  - Both modes run on identical underlying tick/countdown logic; only what *advances* the tick differs.

---

## 4. Piece State & Properties

- Tracking state per piece was chosen over pure "instant adjacency rules" (e.g. "water + magma touching → instantly steam + stone"), because:
  - Instant pairwise rules multiply combinatorially as more piece types/interactions are added.
  - Tracked state allows gradual, emergent behavior (heat gradients, partial transitions) rather than instant flips.
  - It's also cheaper overall in practice, since a small number of general rules replaces a large table of special cases.
- **First tracked property: temperature** (numeric).
- **Planned properties:** density, and (later) gravity-related behavior.
- **Property complexity varies by piece type/category** — e.g., simple pieces like rock have few properties; complex pieces like humans (a future category) will have many more.
- Roughly **~20 piece types** are planned overall (current known subset below).

### Core tick rules (initial minimal set)
1. **Heat transfer:** each tick, a piece's temperature shifts slightly toward the average temperature of its neighbors.
2. **Phase/type transition:** when a piece's temperature crosses a defined threshold, its type changes (e.g. water → steam above boiling point, water → ice below freezing, stone → magma above melting point).

---

## 5. Initial Piece Set (Earth-formation simulation)

First modeling target: a section of a newly formed Earth-like planet's crust and atmosphere, using gravity, density, and temperature as driving forces.

Initial piece types:
- Magma
- Stone
- Ice
- Water
- Steam
- Air
- Smoke
- Fire

(Full ~20-piece roster and other categories, e.g. living things, still to be defined — see Open Questions.)

---

## 6. Rendering

- **View style:** Isometric.
- **Toggleable visibility modes:**
  - **God-mode** — see the entire board regardless of light/obstruction.
  - **Creature-mode** — visibility limited by lighting conditions and line of sight (raycasting through the voxel grid).

---

## 7. Platform & Technical Constraints

- Vanilla HTML, CSS, and JavaScript — no frameworks or external libraries unless explicitly requested.
- Zero dependencies unless asked; favor readable code over clever code.
- Development environment: Android device, F-Droid Termux (git + Python installed), free Claude tier (no Claude Code, no API access).
- Deliverables: complete, copy-pasteable downloadable files (not live-rendered artifacts).
- Real local git via Termux; pushed to GitHub only if/when chosen.

---

## 8. Scalability & Performance Notes

- Tick-based processing (only resolving moves whose countdown hits 0) keeps simulation cost low regardless of board size — not every piece needs evaluation every tick.
- Neighbor-averaging at up to 26 neighbors per piece is computationally cheap even at 64×64×64 scale; expect no performance issues in plain JS at this scale.
- **Rendering, not simulation, is the more likely performance bottleneck** as board size grows — especially isometric rendering with lighting/line-of-sight calculations on a phone.
- Design discipline for future-proofing: avoid hard-coding assumptions like a fixed board size or fixed piece-type count, so the board size and piece roster can grow without rework.

---

## 9. MMO Ambition (OPEN — long-term, not current scope)

- Long-term goal: turn this into an MMO.
- **This is architecturally a separate system from the simulation core**, requiring:
  - An authoritative server (clients cannot each run independent copies and stay in sync)
  - Persistence (world state saved between sessions)
  - Networking (client-server state sync)
  - Concurrency handling (resolving conflicting player actions within the same tick)
- Current dev setup (free Claude tier, no API, Termux/vanilla JS) does not support building this now.
- **Working approach:** design the simulation core so it doesn't hard-code single-player assumptions (e.g. don't assume only one actor can issue moves), without actively building MMO infrastructure yet. Treat MMO as a distant milestone, not a present constraint.

---

## 10. Open Questions

- What makes something win, end, or matter? (No win condition defined yet — Life has none, chess has checkmate. Doesn't need answering now, but will shape move/tick design later.)
- Full roster of ~20 piece types beyond the initial 8 (Earth-formation set).
- What additional complexity/categories exist beyond terrain/matter pieces (e.g. living things, structures)? User has indicated the game has more complexity not yet described.
- Full property list per piece category (only temperature is defined so far; density is planned).
- Gravity's exact mechanical implementation (how it interacts with density and movement rules).

---

*End of v0.07. This document should be updated as more of the game is described, and revised into v0.08+ as design decisions are finalized.*
