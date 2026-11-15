-- Captured entry context belongs to the same Deriv account as its contract.
create table if not exists multiplayer_private.trade_context (
  contract_id uuid primary key references multiplayer_private.contracts(id) on delete cascade,
  account_id text not null references multiplayer_private.accounts(account_id),
  context jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists trade_context_account_updated_idx on multiplayer_private.trade_context(account_id, updated_at desc);
alter table multiplayer_private.trade_context enable row level security;
revoke all on multiplayer_private.trade_context from public, anon, authenticated;
grant all on multiplayer_private.trade_context to service_role;
grant select, insert, update, delete on multiplayer_private.trade_context to multiplayer_runtime;
create policy multiplayer_runtime_access on multiplayer_private.trade_context for all to multiplayer_runtime using (true) with check (true);
