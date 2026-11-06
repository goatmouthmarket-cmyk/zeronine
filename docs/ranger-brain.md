# Ranger Brain (paper research) — v1

Status: **v1 implemented, paper-only.** No demo or real order path exists in the Brain.

## What it is

The main Ranger now carries a Ranger Brain: a deterministic evidence engine that
reads settled **virtual** paper outcomes, measures each market's hours and
weekdays against real break-even, and states plainly when it does not know.
There is no language model in this release — every sentence the Brain shows is
built from a stored number.

The Ghost Scout is untouched. It keeps its independent scanner, patrol and
ledger.

## Architecture in v1

    settled virtual paper outcomes (SQLite trade_ledger, book='paper')
                          |
                          v
    src/brain/timing.ts    Wilson intervals, empirical-Bayes shrinkage,
                           UTC hour / weekday buckets, break-even from payouts
                          |
                          v
    src/brain/policy.ts    paper_shoot | watch | wait, with reason codes
                          |
                          v
    src/brain/service.ts   read model (mind, lessons, hours)
                          |
                          v
    GET /api/ranger-brain/status   (public read-only, 10s memo, no-store)
                          |
                          v
    web/public/trading-room.html   brain resting on the ranger's crown,
                                   right-click / long-press menu, thinking pose

### How the pasture presents it

The panel answers three questions with shapes before text: a **trust ring**
(filled by settled outcomes against `BRAIN_MIN_MARKET_OUTCOMES`, pips for the
last few tenths), a **break-even gauge** (a notch at the mark, green fill when
paper wins sit above it, red below), and a **day map** (24 UTC bars, gold
outline on the strongest hour, ring on the current one). The default view shows
no win-rate, break-even or P&L figures; those live in the tooltips and in the
Training and Hours tabs, where someone is deliberately reading detail. Every
sentence is generated from the same evidence object, and `insufficient data`
stays a normal visible state rather than an empty panel.

The brain glyph is anchored to the exposed head position
(`window.__zeronineRanger.head()`), so it sits on the crown and moves with the
ranger instead of floating beside him. It is drawn as a stroke, not a chip, and
keeps the gold hourglass language of the rest of the HUD.

### Deviation from the Python-first plan

The handoff plan put the learner in a separate Python worker on Railway with a
`ranger_brain_private` PostgreSQL schema. That is still the target for the
offline research worker, but v1 deliberately runs the deterministic baseline
inside the existing Node service because:

- It must not block or duplicate the quote/execution path, and the Node service
  already owns the data, the auth and the session.
- No deployment authorization was given, so an unverifiable Python service
  would have been dead code in this repository.
- The baseline is arithmetic (intervals, shrinkage, thresholds) with no
  dependency on scikit-learn. Keeping it in TypeScript makes the same numbers
  available to the real-time decision path and the tests at once.

The offline learner can still be added as a worker that *beats* this baseline on
forward data. The JSON contract below is versioned so that swap is additive.

## Decision contract

`decidePaperAction(context, settings)` returns:

```json
{
  "action": "wait",
  "reasonCodes": ["INSUFFICIENT_EVIDENCE", "PAPER_ONLY"],
  "edge": null,
  "reason": "0 settled outcomes; 100 are needed before any shot.",
  "evidence": { "market": "Volatility 100", "outcomes": 0, "breakeven": null }
}
```

Gate order: feed present → tick fresh (≤ 15s) → no open virtual contract →
≥ 100 settled outcomes → break-even known → hour not unfavorable → candidate
probability exists → edge ≥ 1% and above break-even. Anything else is `wait`
or `watch`. `paper_shoot` is only ever a *virtual* instruction; the policy has
no account mode, and `PAPER_ONLY` is always present.

## Honesty rules encoded in tests

- A bucket needs 30 settled outcomes before it may be described at all
  (`BRAIN_MIN_BUCKET_OUTCOMES`).
- `favorable` requires the **Wilson lower bound** to clear break-even by 2%;
  `unfavorable` requires the upper bound to sit 2% below it. Everything between
  is `mixed`, and `bestHour` is `null` when nothing separates.
- Buckets are keyed by the UTC hour of the **decision** (`opened_at`), and any
  outcome settled after `now` is excluded, so an evaluation cannot see the
  future (`tests/rangerBrainTiming.test.ts`).
- Rates are shrunk toward the market's own rate, so a 3-of-3 hour cannot outrank
  a 300-outcome one.
- Markets are never pooled: Volatility 75 losses cannot drag Volatility 100.
- Zero evidence means `offline`, not a placeholder win rate. Lessons always carry
  their own sample count.

## Data coverage and limitations

- Evidence comes from `listPaperTrades` (last 500 settled virtual contracts, 30-day
  default lookback). Telemetry retention is 30 days; older browser-only studies
  are not included, so early reports will read `insufficient`.
- Break-even is derived from the recorded stake and win profit (falling back to
  the standard 95% digit payout before the first settled win).
- The sample-size bar (100) is intentionally higher than the per-bucket bar (30):
  an hour needs both its own bucket and a market-wide record to be meaningful.
- Nothing is persisted by the Brain itself in v1 — no profiles, settings, model
  versions or lessons table. The report is derived from the paper ledger on
  demand, which is why it survives refresh, restart and redeploy today.

## Next batches (not implemented)

1. Persist observations/decisions/outcomes/lessons (PostgreSQL
   `ranger_brain_private`, least privilege, RLS, retention).
2. Python offline worker that trains a candidate model on exported evidence and
   must beat `baseline-v1` on forward data before any paper promotion.
3. Owner settings route (enable/pause, thresholds, thoughts mode) and a
   parent↔iframe state handshake so `App.tsx` and the pasture cannot disagree.
4. Demo-account integration — only after forward paper validation, and always
   through the existing risk gates. Real money stays a separate, explicit
   decision.

## Security notes

- `GET /api/ranger-brain/status` is readable by every pasture visitor, guests
  included: the report is paper research with no balance, token or account id,
  and gating it on owner access is what kept the brain from loading in
  production. Owner-only routes keep `requireOwner` and are untouched.
- The route memoises one report per `market`/`lookbackDays` pair for ten
  seconds, so a public caller cannot force a paper-ledger rescan per request.
- The endpoint is read-only, returns no balances, tokens or account identifiers,
  and sends `cache-control: no-store`.
- No credential ever leaves Node: the browser talks only to its own origin.
