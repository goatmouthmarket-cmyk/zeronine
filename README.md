# Over/Under Digit Sniper

Deriv synthetic-indices bot that watches every market carrying Over/Under digit contracts, bets the strongest one, and uses quote-driven **intelligent money recovery** (barrier escalation, martingale fallback) to claw back losses in a single trade.

Runs on **Node 24** (native TypeScript type-stripping, built-in `node:sqlite`) — no build step, no external DB.

## Strategy

- Streams **all** synthetic indices that support `DIGITOVER`/`DIGITUNDER` (currently 8: `1HZ10V` … `1HZ100V`).
- Per trade it picks the market + direction/barrier with the best edge (`estimated win rate − breakeven`).
- **Base bet**: the configured preference (default `over 1`, ~80% win) at `base_stake`.
- On a loss, **recovery mode** scans live quotes and escalates the barrier (e.g. `over 1 → 3 → 5 → 7`) at the lowest stake that wins back everything in one trade — win, and it reverts to base. Martingale (doubling) is the fallback if no good quote is found.
- Risk gates: max stake, balance floor, peak drawdown, single open contract, minimum trade gap, consecutive-loss pause.

## Quickstart (local)

```powershell
# Node 24+ on PATH (this repo ships a portable copy in node-v24.18.0-win-x64/)
npm install          # registry mirror pinned in .npmrc (npmmirror)
Copy-Item .env.example .env
# fill in your Deriv demo API token (app.deriv.com -> API token)
npm run build:web    # build dashboard into web/dist
npm run dev          # API on :8010, serves dashboard at http://localhost:8010
```

Development with hot-reload UI:

```powershell
npm run dev          # terminal 1: API on :8010
npm run web:dev      # terminal 2: Vite on :5173 (proxies /api and /ws to :8010)
```

## Connect & trade

1. Create a **demo** API token at `app.deriv.com → API token`.
2. Open the dashboard → **Trade → Connect** and paste it.
   - Sessions use the OTP socket flow on `api.derivws.com` (`GET /accounts`, `POST /accounts/{id}/otp`) — it works even where `ws.deriv.com` is unreachable.
3. **Manual trade**: pick market/direction/barrier/stake → *Buy*.
4. **Auto Sniper**: *START* to run the strongest-market loop. On a **real** account you must *ARM 10min* first (recovery requires a 10-minute arm, demo does not).
5. *Settings*: stake caps, drawdown limits, martingale depth, edge thresholds.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness (feed connected, market count, automation state) |
| GET | `/api/state` | one-shot dashboard snapshot |
| GET | `/api/markets` | persisted market list + live snapshots |
| GET | `/api/history?limit=` | recent trades |
| GET/PUT | `/api/settings` | read/update strategy settings |
| POST | `/api/auth/pat` | connect a PAT (creates OTP session, stores encrypted) |
| POST | `/api/auth/logout` | disconnect + clear session |
| POST | `/api/trade/manual` | place one trade |
| POST | `/api/automation/start` · `/stop` · `/arm` | automation controls |
| WS | `/ws` | live events: tick, signal, decision, trade, contract, recovery, status |

## Deploy (Railway)

- `railway.toml` builds `npm ci` + `web/dist`, starts `node src/main.ts`, health-checks `/health`, and mounts a persistent volume at `/data` (`DATA_DIR=/data` keeps trades/digits across redeploys).
- Set env in Railway: `DERIV_PAT` (or OAuth vars `DERIV_OAUTH_CLIENT_ID`/`SECRET`/`REDIRECT_URI`), `SESSION_SECRET`, stake/risk overrides. `PORT` is provided automatically.
- Real-account automation still requires a 10-minute arm per session.

## Verify

```powershell
npm run typecheck   # tsc --noEmit (server)
npm test            # node --test "tests/*.test.ts"
npm run build:web   # vite build web
```

## Layout

```
src/
  main.ts               server wiring, static dashboard, tick persistence
  config.ts             env-driven config
  db/                   node:sqlite (markets, digits, trades, recovery, settings, sessions) + AES-GCM token encryption
  deriv/                public tick feed (api.derivws.com) + private client (OTP socket, quotes, buys, settlement)
  core/                 digit math, market registry (60-tick windows), protocol message builders
  strategy/             signal picker, quote-driven recovery planner, risk gates, automation loop
  api/                  Fastify routes, hub event bus, browser websocket
web/                    Preact + Tailwind mobile dashboard (Vite)
tests/                  unit + HTTP tests
```
