create table multiplayer_private.account_risk (
  account_id text primary key references multiplayer_private.accounts(account_id) on delete cascade,
  mode text not null default 'base' check (mode in ('base', 'recovering')),
  streak integer not null default 0,
  debt numeric not null default 0,
  attempts integer not null default 0,
  cycle_stake numeric not null default 0,
  peak_balance numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table multiplayer_private.account_risk enable row level security;
revoke all on multiplayer_private.account_risk from public, anon, authenticated;
grant all on multiplayer_private.account_risk to service_role;
