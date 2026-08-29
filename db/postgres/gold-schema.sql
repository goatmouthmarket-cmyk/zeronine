-- ZeroNine Gold PostgreSQL schema (planning artifact; not wired into runtime).
--
-- This schema is intentionally isolated from src/db/store.ts and the legacy
-- SQLite data directory. Apply it only to the dedicated Gold PostgreSQL
-- database described in docs/gold-ctrader-railway.md.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE gold_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE gold_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES gold_users(id),
  provider TEXT NOT NULL CHECK (provider = 'ctrader'),
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'live')),
  status TEXT NOT NULL CHECK (status IN (
    'pending_authorization', 'active', 'refresh_required', 'revoked', 'error', 'disconnected'
  )),
  provider_subject TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, provider, environment)
);

CREATE TABLE gold_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES gold_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES gold_users(id),
  state_hash TEXT NOT NULL UNIQUE,
  pkce_verifier_cipher TEXT NOT NULL,
  cipher_key_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE TABLE gold_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL UNIQUE REFERENCES gold_connections(id) ON DELETE CASCADE,
  access_token_cipher TEXT NOT NULL,
  refresh_token_cipher TEXT,
  cipher_key_id TEXT NOT NULL,
  token_type TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at)
);

CREATE TABLE gold_broker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES gold_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES gold_users(id),
  provider_account_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'live')),
  currency TEXT NOT NULL,
  leverage NUMERIC(20, 8),
  balance NUMERIC(20, 8),
  equity NUMERIC(20, 8),
  free_margin NUMERIC(20, 8),
  margin_level NUMERIC(20, 8),
  broker_updated_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'closed', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_account_id),
  UNIQUE (user_id, environment, provider_account_id)
);

CREATE TABLE gold_order_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES gold_broker_accounts(id),
  user_id UUID NOT NULL REFERENCES gold_users(id),
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'live')),
  idempotency_key TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop')),
  requested_volume NUMERIC(20, 8) NOT NULL CHECK (requested_volume > 0),
  requested_price NUMERIC(20, 8),
  stop_loss NUMERIC(20, 8),
  take_profit NUMERIC(20, 8),
  signal_id TEXT,
  model_version TEXT,
  risk_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL CHECK (state IN (
    'validated', 'submitted', 'accepted', 'rejected', 'filled', 'cancelled', 'unknown'
  )),
  provider_order_id TEXT,
  submitted_at TIMESTAMPTZ,
  final_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, client_order_id)
);

CREATE TABLE gold_execution_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  account_id UUID REFERENCES gold_broker_accounts(id),
  order_intent_id UUID REFERENCES gold_order_intents(id),
  user_id UUID NOT NULL REFERENCES gold_users(id),
  provider TEXT NOT NULL CHECK (provider = 'ctrader'),
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'live')),
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE gold_worker_leases (
  lease_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT 1,
  CHECK (expires_at > acquired_at)
);

-- OAuth callbacks are both time-sensitive and single-use. The partial index
-- is used by the transactional consume query.
CREATE INDEX gold_oauth_states_unconsumed_expiry_idx
  ON gold_oauth_states (expires_at) WHERE used_at IS NULL;
CREATE INDEX gold_connections_user_status_idx
  ON gold_connections (user_id, status, environment);
CREATE INDEX gold_accounts_connection_idx
  ON gold_broker_accounts (connection_id, status);
CREATE INDEX gold_order_intents_account_state_idx
  ON gold_order_intents (account_id, state, created_at DESC);
CREATE INDEX gold_order_intents_user_created_idx
  ON gold_order_intents (user_id, created_at DESC);
CREATE INDEX gold_execution_events_order_received_idx
  ON gold_execution_events (order_intent_id, received_at);
CREATE INDEX gold_execution_events_account_occurred_idx
  ON gold_execution_events (account_id, occurred_at DESC);
CREATE INDEX gold_worker_leases_expiry_idx
  ON gold_worker_leases (expires_at);

COMMIT;
