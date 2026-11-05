-- Server-only multiplayer records. Browser roles have no access to this schema.
create schema if not exists multiplayer_private;
revoke all on schema multiplayer_private from public, anon, authenticated;
grant usage on schema multiplayer_private to service_role;

create table multiplayer_private.accounts (
  account_id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table multiplayer_private.sessions (
  session_hash text primary key check (session_hash ~ '^[0-9a-f]{64}$'),
  account_id text not null references multiplayer_private.accounts(account_id) on delete cascade,
  token_cipher text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index multiplayer_sessions_account_idx on multiplayer_private.sessions(account_id);

create table multiplayer_private.contracts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references multiplayer_private.accounts(account_id),
  idempotency_key text not null,
  status text not null check (status in ('purchasing','open','unknown','won','lost','cancelled','error')),
  provider_contract_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, idempotency_key)
);
-- Uncertain purchases remain reserved until reconciled with the provider.
create unique index multiplayer_one_active_contract_per_account
  on multiplayer_private.contracts(account_id)
  where status in ('purchasing', 'open', 'unknown');

create table multiplayer_private.rooms (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table multiplayer_private.room_members (
  room_id uuid not null references multiplayer_private.rooms(id) on delete cascade,
  account_id text not null references multiplayer_private.accounts(account_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(room_id, account_id)
);
create table multiplayer_private.room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  account_id text not null,
  body text not null check (char_length(body) between 1 and 160),
  created_at timestamptz not null default now(),
  foreign key (room_id, account_id) references multiplayer_private.room_members(room_id, account_id)
);
create index multiplayer_messages_room_idx on multiplayer_private.room_messages(room_id, id desc);

alter table multiplayer_private.accounts enable row level security;
alter table multiplayer_private.sessions enable row level security;
alter table multiplayer_private.contracts enable row level security;
alter table multiplayer_private.rooms enable row level security;
alter table multiplayer_private.room_members enable row level security;
alter table multiplayer_private.room_messages enable row level security;
revoke all on all tables in schema multiplayer_private from public, anon, authenticated;
revoke all on all sequences in schema multiplayer_private from public, anon, authenticated;
grant all on all tables in schema multiplayer_private to service_role;
grant usage, select on all sequences in schema multiplayer_private to service_role;
