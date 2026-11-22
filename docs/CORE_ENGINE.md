# Core Over/Under engine

Core is the single game decision source. The previous pasture implementation is
preserved in Git at ca738e9a59064fe27d9c7b71cd9e51e8dd46a640 and is not a selectable game mode.

## Decisions and execution

- src/core/predictionEngine.ts contains pure shared probability, ranking and quote math.
- The initial model shrinks observed digits toward the uniform contract baseline.
  It is an estimate, not a demonstrated predictive advantage.
- The default pasture/research contract policy is the same balanced Over/Under
  pool (70–80% theoretical baseline). All valid barriers are supported by the engine.
- Live ask/payout determine quoted break-even, edge and expected return.
- Cows, rings, Brain and Auto display Core output; browser code never adds confidence.
- Core rechecks the exact contract at quote/confirmation. Auto cannot substitute a
  different barrier after an animation while keeping the original stake.
- A decision snapshot, account source, quote and contract ID trace a purchase.
  Research requests quotes only; it never invokes buy, recovery or account balance writes.

## Persistence

Apply supabase/migrations/202611220001_core_engine.sql as the project owner after
the existing multiplayer/Brain migrations. The application runtime must not gain
schema-owner privileges. New tables live in core_private with RLS enabled;
browsers have no direct access.

Decision snapshots and attempts are append-only. Lesson rules have explicit source
trade UUIDs, versions and typed conditions. Evaluations retain matching,
comparison and missing-data records, independent of the latest UI history window.
Jobs retry evaluation after asynchronous trade context completes and can recover
decision/attempt metadata from stored trade context.

A missing Core migration leaves manual account/risk checks available, but Research
and Core Auto activation remain unavailable with an explicit message.

## Human lessons

The user reviews a settled trade and confirms a high/low sequence or an entry
edge/confidence range. Unstructured notes are retained as notes, not executable
rules. Only later settled same-account/mode/market/contract records can evaluate
a rule. Core tick windows require contiguous arrival IDs in the same segment.

A good/bad assessment is separate from the trade winning or losing. Both helpful
and adverse effects may affect probability after sufficient forward evidence;
correlated rules do not stack. Range combinations are evaluated but do not yet
adjust the digit model. Missing data never becomes a fabricated outcome.

## Research and activation

Research uses virtual money, live proposal prices and a future next-tick fill.
Captured paper outcomes are estimates of execution, not broker trades. Quote
latency, missing ticks, reconnects and saving failures are visible. A saved run
restores paused; no process restart silently resumes a run.

Core Auto activation requires explicit user action and a completed forward pilot:
200 settlements, positive virtual net return, at most 5% missing fills, and
probability error no worse than its baseline. Evidence is policy/version scoped
and expires after seven days. This is a pilot gate, not proof of profitability.
Existing broker risk, single-open-contract and real-account protections remain.

## Checks

Run npm run typecheck, npm run typecheck:web, npm test and npm run build:web.
In the Windows sandbox, Vite can require --configLoader runner.
The Core domain, lesson, paper and browser-adapter tests exercise real contracts
with fake quotes/ticks; never use actual purchases for automated verification.

