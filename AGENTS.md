# Repository Guidance

## Stack And Layout

- This is a Node 24+ ESM TypeScript service. It runs `.ts` files directly with Node's native type stripping; retain `"type": "module"` and use explicit `.ts` extensions for local server and test imports.
- `src/` contains Fastify server and API wiring, Deriv clients, SQLite persistence, core digit math and state, strategy automation, and test-lab logic. Keep domain work in its existing layer; routes should coordinate rather than absorb strategy or persistence rules.
- `web/` is a Preact, Vite, and Tailwind dashboard. Use `npm run web:dev` for the client on port 5173 and `npm run dev` for the API on port 8010. Fastify serves the committed `web/dist` bundle in production.
- SQLite data lives under `DATA_DIR` (default `data/`) and is ignored. Do not commit `.env`, data, logs, or `node_modules`; update `.env.example` for configuration additions.

## Change Expectations

- Preserve trading risk gates, single-open-contract semantics, demo and real-account safeguards, and recovery-state behavior unless a change explicitly intends to alter them.
- When changing settings, update the typed settings row, SQLite schema/default and migration handling in `src/db/store.ts`, API validation and routes, config and environment defaults where appropriate, and dashboard state and UI as needed.
- Keep browser API and WebSocket contract changes aligned across `src/api/`, server event emitters, and `web/src/store.ts` and `web/src/App.tsx`.
- Keep sensitive tokens encrypted through the existing session and crypto flow; never log or return PATs or OAuth tokens.

## Validation

- Tests use Node's built-in `node:test` in `tests/*.test.ts`; run `npm test` for server or domain changes.
- Run `npm run typecheck` for `src` and `tests`, `npm run typecheck:web` for dashboard changes, and `npm run build:web` when touching frontend or build output.
- `npm run verify` runs the complete typecheck, test, and dashboard-build suite.

## Delivery

- After each completed, verified edit set, commit it and push the current branch unless the user directs otherwise.
