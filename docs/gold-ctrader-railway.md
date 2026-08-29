# Gold cTrader and Railway Deployment

## Status

Gold is a separate application domain inside the ZeroNine repository. Its
current TypeScript domain code is intentionally read-only or virtual-paper
only. The PostgreSQL schema in `db/postgres/gold-schema.sql` is a deployment
plan artifact: it is **not currently applied, connected to the server, or a
migration run by this application**.

Legacy Deriv data remains in SQLite at `DATA_DIR/overunder.db`. Do not point
`DATA_DIR` at PostgreSQL, copy the SQLite token/session table into Gold, or
share Gold execution state with digit automation. Gold must keep separate
user ownership, broker connections, balances, order intents, risk state, and
audit events.

## PostgreSQL data model

Apply `db/postgres/gold-schema.sql` to a dedicated Railway PostgreSQL service
once the Gold runtime repository layer is implemented. It creates:

| Table | Purpose |
| --- | --- |
| `gold_users` | Maps an authenticated ZeroNine user to Gold-owned data. |
| `gold_connections` | One cTrader connection per user and environment. |
| `gold_oauth_states` | Hash of OAuth state and encrypted PKCE verifier, consumed atomically. |
| `gold_oauth_tokens` | Encrypted cTrader token set, never browser-visible. |
| `gold_broker_accounts` | Authorized account metadata and reconciled balances. |
| `gold_order_intents` | Idempotent, risk-approved execution requests. |
| `gold_execution_events` | Append-only, redacted broker lifecycle/audit evidence. |
| `gold_worker_leases` | A fenced singleton lease for connection/reconciliation workers. |

The schema uses PostgreSQL `pgcrypto` only for UUID generation. Application
code must encrypt OAuth secrets before writing `*_cipher` columns with
authenticated encryption, store the key identifier in `cipher_key_id`, and
support rotation. Never put a plaintext token, authorization code, client
secret, or sensitive websocket payload in PostgreSQL JSON, logs, API output,
or browser state.

The eventual OAuth callback must run a single transaction that locks the
matching unused state, verifies user, expiry, and hash in constant time,
marks it consumed, then stores the encrypted token and updates the connection.
An update affecting zero rows is a rejected replay. The schema alone does not
provide that behavior.

## Required environment variables

These variables are for the future Gold runtime and should be configured in
Railway rather than committed to `.env`:

```text
DATABASE_URL=postgresql://...                         # Gold PostgreSQL only
APP_BASE_URL=https://your-zeronine-domain
APP_SESSION_SECRET=<32+ random bytes>
TOKEN_ENCRYPTION_KEY=<base64 32-byte AES key>
TOKEN_ENCRYPTION_KEY_ID=gold-k1

CTRADER_CLIENT_ID=<cTrader Open API application id>
CTRADER_CLIENT_SECRET=<cTrader Open API application secret>
CTRADER_REDIRECT_URI=https://your-zeronine-domain/api/gold/oauth/callback
CTRADER_DEMO_ENDPOINT=<official cTrader demo endpoint>
CTRADER_LIVE_ENDPOINT=<official cTrader live endpoint>
GOLD_LIVE_ENABLED=0

GOLD_WORKER_ID=<unique deployment instance id>
GOLD_WORKER_LEASE_TTL_MS=30000
GOLD_WORKER_HEARTBEAT_MS=10000
```

`CTRADER_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and session secrets must be
Railway secret variables. Use different encryption keys and cTrader apps for
development/staging/production. Set `GOLD_LIVE_ENABLED=0` in every environment
until the live activation checklist is complete. Existing `SESSION_SECRET` and
Deriv variables remain for legacy functionality; they are not substitutes for
multi-user Gold session and token handling.

## cTrader application registration

1. Register a cTrader Open API application with a production callback URL
   matching `CTRADER_REDIRECT_URI` exactly, including scheme and path.
2. Register separate local/staging callback URLs only in their corresponding
   non-production app registrations.
3. Use authorization-code OAuth with PKCE. Generate state and verifier on the
   server; retain only the encrypted verifier and a hash of state in PostgreSQL.
4. On callback, exchange the code server-side. Discover authorized accounts
   from cTrader and bind them to the authenticated ZeroNine user. Do not accept
   an account ID supplied by the browser as proof of ownership.
5. Keep demo and live connections, endpoints, account records, workers, and
   execution guards separate. A demo token or account must never be usable
   against a live endpoint.

The application must dynamically find an authorized Gold symbol and its
precision, volume steps, trading hours, and margin details. It must not assume
that a broker exposes a symbol called `XAUUSD`.

## Railway layout

Use the same GitHub repository and Railway project, with independent services:

1. **ZeroNine web/API**: existing Fastify deployment, including the legacy
   SQLite volume for Deriv only.
2. **Gold PostgreSQL**: a Railway PostgreSQL service. Attach its private
   `DATABASE_URL` only to Gold-capable API/worker services.
3. **Gold worker**: a later process/service that maintains cTrader connections,
   renews tokens, reconciles accounts/orders/positions, and executes approved
   intents. It acquires `gold_worker_leases` before doing account work.

At first, the Gold worker should run in demo-only mode. The worker must use a
lease acquisition query with row locking and increment the fencing token on
takeover. Every side-effecting action must verify both lease ownership and the
current fencing token. If the lease cannot be renewed, the worker must stop
new order submission and reconnect/reconcile from the broker before resuming.

For an initial single-service implementation, keep the same transaction,
idempotency, and lease semantics. Do not rely on in-memory maps for OAuth
state, order state, or worker ownership because Railway restarts and replicas
make them unsafe.

## Demo execution path

The first broker-connected release is demo only:

1. User authenticates and explicitly chooses a cTrader **demo** account.
2. API verifies account ownership, fresh quotes, symbol specifications, market
   status, Gold risk approval, and that no incompatible position/order exists.
3. API writes one idempotent `gold_order_intents` row before submitting the
   broker order. A retry reuses the same client order ID; it never blindly buys
   again.
4. Worker submits, records redacted lifecycle events, then reconciles broker
   order, position, balance, equity, and margin until terminal.
5. UI presents broker-confirmed demo data separately from Gold Paper Trade and
   never merges it into Deriv balances or digit P&L.

Paper trading remains virtual and is not evidence of a broker fill. Backtests
remain historical simulations and may not be used to automatically enable
live trading.

## Live activation checklist

Keep live execution off until all of the following are complete:

- cTrader demo OAuth, token refresh, reconnect, order idempotency, and
  reconciliation have been exercised over repeated Railway restarts.
- Demo account balances, positions, fills, stops, and rejected orders reconcile
  to broker state without manual repair.
- Quote freshness, closed market, spread, symbol specification, margin,
  position limits, daily loss, drawdown, and emergency stop guards are covered
  by automated tests and an operator review.
- Append-only execution events and audit ownership are retained and verified.
- A deliberate production configuration review confirms correct live endpoint,
  allowed account IDs, origin URLs, redirect URI, encryption key ID, and
  `GOLD_LIVE_ENABLED=1`.

No strategy model, research confidence, Paper Trade result, or backtest score
is authority to bypass these controls.

## Operations and diagnostics

Expose diagnostics without secrets: connection state, token expiry window,
last successful broker heartbeat, worker lease owner/age, latest reconciliation
time, account environment, and last redacted error code. Do not expose raw
tokens, callback codes, full broker payloads, or internal encryption fields.

Create routine retention jobs for expired OAuth state and bounded market data.
Do not delete execution events or order intents without a documented audit
retention policy. Test PostgreSQL restore and encryption key-rotation recovery
before relying on Gold demo execution.
