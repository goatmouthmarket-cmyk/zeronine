alter table multiplayer_private.contracts
  add column market text not null default '',
  add column direction text not null default '' check (direction in ('', 'over', 'under')),
  add column barrier integer not null default 0,
  add column stake numeric(18, 4) not null default 0,
  add column ask_price numeric(18, 4) not null default 0,
  add column payout numeric(18, 4) not null default 0,
  add column profit numeric(18, 4) not null default 0,
  add column mode text not null default '' check (mode in ('', 'demo', 'real')),
  add column settled_at timestamptz;
create index multiplayer_contracts_account_recent_idx
  on multiplayer_private.contracts(account_id, created_at desc);
