-- Human Brain memories and durable evidence journal.
-- Run as the Supabase project owner. The app connects only as multiplayer_runtime.
create schema if not exists brain_private;
revoke all on schema brain_private from public, anon, authenticated;
grant usage on schema brain_private to multiplayer_runtime;

create table if not exists brain_private.profiles (
  owner_key text primary key check (owner_key ~ '^[0-9a-f]{64}
  id uuid primary key default gen_random_uuid(),
  owner_key text not null references brain_private.profiles(owner_key) on delete cascade check (owner_key ~ '^[0-9a-f]{64} text not null check (length(market_symbol) between 1 and 64),
  market_name text not null check (length(market_name) between 1 and 100),
  category text not null check (category in ('market_behavior', 'setup', 'entry_timing', 'risk')),
  observation text not null check (length(observation) between 8 and 500),
  expected_direction text not null check (expected_direction in ('over', 'under', 'none')),
  barrier smallint check (barrier is null or barrier between 0 and 9),
  horizon text not null check (horizon in ('next_5', 'next_20', 'next_session')),
  confidence smallint not null check (confidence between 1 and 5),
  check ((expected_direction = 'none' and barrier is null) or (expected_direction in ('over','under') and barrier between 0 and 9)),
  outcome text not null default 'pending' check (outcome in ('pending', 'matched', 'unmatched')),
  linked_trade_id uuid references multiplayer_private.contracts(id) on delete set null,
  linked_trade_outcome text check (linked_trade_outcome is null or linked_trade_outcome in ('won', 'lost')),
  xp_earned integer not null default 10 check (xp_earned >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists brain_insights_owner_recent on brain_private.insights(owner_key, created_at desc);
create index if not exists brain_insights_owner_pattern on brain_private.insights(owner_key, market_symbol, category, expected_direction, barrier, horizon);
create unique index if not exists brain_insights_unique_linked_trade on brain_private.insights(linked_trade_id) where linked_trade_id is not null;

create table if not exists brain_private.evidence_memory_events (
  id uuid primary key default gen_random_uuid(),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null,
  lesson_id text not null,
  topic text not null,
  finding text not null,
  fingerprint text not null,
  validity text not null check (validity in ('provisional', 'validated')),
  outcomes integer not null check (outcomes > 0),
  evidence_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (market_symbol, lesson_id, fingerprint)
);
create index if not exists brain_evidence_market_recent on brain_private.evidence_memory_events(market_symbol, created_at desc);

alter table brain_private.insights enable row level security;
alter table brain_private.evidence_memory_events enable row level security;
revoke all on brain_private.profiles, brain_private.insights, brain_private.evidence_memory_events from public, anon, authenticated;
grant select, insert, update on brain_private.profiles, brain_private.insights to multiplayer_runtime;
grant select, insert on brain_private.evidence_memory_events to multiplayer_runtime;

alter table brain_private.profiles enable row level security;
drop policy if exists brain_runtime_profiles_access on brain_private.profiles;
create policy brain_runtime_profiles_access on brain_private.profiles
  for all to multiplayer_runtime using (true) with check (true);

drop policy if exists brain_runtime_insights_access on brain_private.insights;
create policy brain_runtime_insights_access on brain_private.insights
  for all to multiplayer_runtime using (true) with check (true);
drop policy if exists brain_runtime_evidence_access on brain_private.evidence_memory_events;
create policy brain_runtime_evidence_access on brain_private.evidence_memory_events
  for all to multiplayer_runtime using (true) with check (true);
),
  display_name text not null check (length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists brain_private.insights (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null check (owner_key ~ '^[0-9a-f]{64}$'),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null check (length(market_name) between 1 and 100),
  category text not null check (category in ('market_behavior', 'setup', 'entry_timing', 'risk')),
  observation text not null check (length(observation) between 8 and 500),
  expected_direction text not null check (expected_direction in ('up', 'down', 'sideways', 'unclear')),
  horizon text not null check (horizon in ('next_5', 'next_20', 'next_session')),
  confidence smallint not null check (confidence between 1 and 5),
  outcome text not null default 'pending' check (outcome in ('pending', 'matched', 'unmatched', 'unclear')),
  outcome_note text check (outcome_note is null or length(outcome_note) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists brain_insights_owner_recent on brain_private.insights(owner_key, created_at desc);
create index if not exists brain_insights_owner_pattern on brain_private.insights(owner_key, market_symbol, category, expected_direction, horizon);

create table if not exists brain_private.evidence_memory_events (
  id uuid primary key default gen_random_uuid(),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null,
  lesson_id text not null,
  topic text not null,
  finding text not null,
  fingerprint text not null,
  validity text not null check (validity in ('provisional', 'validated')),
  outcomes integer not null check (outcomes > 0),
  evidence_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (market_symbol, lesson_id, fingerprint)
);
create index if not exists brain_evidence_market_recent on brain_private.evidence_memory_events(market_symbol, created_at desc);

alter table brain_private.insights enable row level security;
alter table brain_private.evidence_memory_events enable row level security;
revoke all on brain_private.insights, brain_private.evidence_memory_events from public, anon, authenticated;
grant select, insert, update on brain_private.insights to multiplayer_runtime;
grant select, insert on brain_private.evidence_memory_events to multiplayer_runtime;

drop policy if exists brain_runtime_insights_access on brain_private.insights;
create policy brain_runtime_insights_access on brain_private.insights
  for all to multiplayer_runtime using (true) with check (true);
drop policy if exists brain_runtime_evidence_access on brain_private.evidence_memory_events;
create policy brain_runtime_evidence_access on brain_private.evidence_memory_events
  for all to multiplayer_runtime using (true) with check (true);
),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null check (length(market_name) between 1 and 100),
  category text not null check (category in ('market_behavior', 'setup', 'entry_timing', 'risk')),
  observation text not null check (length(observation) between 8 and 500),
  expected_direction text not null check (expected_direction in ('over', 'under', 'none')),
  barrier smallint check (barrier is null or barrier between 0 and 9),
  horizon text not null check (horizon in ('next_5', 'next_20', 'next_session')),
  confidence smallint not null check (confidence between 1 and 5),
  outcome text not null default 'pending' check (outcome in ('pending', 'matched', 'unmatched')),
  linked_trade_id uuid,
  linked_trade_outcome text check (linked_trade_outcome is null or linked_trade_outcome in ('won', 'lost')),
  xp_earned integer not null default 10 check (xp_earned >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists brain_insights_owner_recent on brain_private.insights(owner_key, created_at desc);
create index if not exists brain_insights_owner_pattern on brain_private.insights(owner_key, market_symbol, category, expected_direction, barrier, horizon);
create unique index if not exists brain_insights_unique_linked_trade on brain_private.insights(linked_trade_id) where linked_trade_id is not null;

create table if not exists brain_private.evidence_memory_events (
  id uuid primary key default gen_random_uuid(),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null,
  lesson_id text not null,
  topic text not null,
  finding text not null,
  fingerprint text not null,
  validity text not null check (validity in ('provisional', 'validated')),
  outcomes integer not null check (outcomes > 0),
  evidence_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (market_symbol, lesson_id, fingerprint)
);
create index if not exists brain_evidence_market_recent on brain_private.evidence_memory_events(market_symbol, created_at desc);

alter table brain_private.insights enable row level security;
alter table brain_private.evidence_memory_events enable row level security;
revoke all on brain_private.profiles, brain_private.insights, brain_private.evidence_memory_events from public, anon, authenticated;
grant select, insert, update on brain_private.profiles, brain_private.insights to multiplayer_runtime;
grant select, insert on brain_private.evidence_memory_events to multiplayer_runtime;

alter table brain_private.profiles enable row level security;
drop policy if exists brain_runtime_profiles_access on brain_private.profiles;
create policy brain_runtime_profiles_access on brain_private.profiles
  for all to multiplayer_runtime using (true) with check (true);

drop policy if exists brain_runtime_insights_access on brain_private.insights;
create policy brain_runtime_insights_access on brain_private.insights
  for all to multiplayer_runtime using (true) with check (true);
drop policy if exists brain_runtime_evidence_access on brain_private.evidence_memory_events;
create policy brain_runtime_evidence_access on brain_private.evidence_memory_events
  for all to multiplayer_runtime using (true) with check (true);
),
  display_name text not null check (length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists brain_private.insights (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null check (owner_key ~ '^[0-9a-f]{64}$'),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null check (length(market_name) between 1 and 100),
  category text not null check (category in ('market_behavior', 'setup', 'entry_timing', 'risk')),
  observation text not null check (length(observation) between 8 and 500),
  expected_direction text not null check (expected_direction in ('up', 'down', 'sideways', 'unclear')),
  horizon text not null check (horizon in ('next_5', 'next_20', 'next_session')),
  confidence smallint not null check (confidence between 1 and 5),
  outcome text not null default 'pending' check (outcome in ('pending', 'matched', 'unmatched', 'unclear')),
  outcome_note text check (outcome_note is null or length(outcome_note) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists brain_insights_owner_recent on brain_private.insights(owner_key, created_at desc);
create index if not exists brain_insights_owner_pattern on brain_private.insights(owner_key, market_symbol, category, expected_direction, horizon);

create table if not exists brain_private.evidence_memory_events (
  id uuid primary key default gen_random_uuid(),
  market_symbol text not null check (length(market_symbol) between 1 and 64),
  market_name text not null,
  lesson_id text not null,
  topic text not null,
  finding text not null,
  fingerprint text not null,
  validity text not null check (validity in ('provisional', 'validated')),
  outcomes integer not null check (outcomes > 0),
  evidence_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (market_symbol, lesson_id, fingerprint)
);
create index if not exists brain_evidence_market_recent on brain_private.evidence_memory_events(market_symbol, created_at desc);

alter table brain_private.insights enable row level security;
alter table brain_private.evidence_memory_events enable row level security;
revoke all on brain_private.insights, brain_private.evidence_memory_events from public, anon, authenticated;
grant select, insert, update on brain_private.insights to multiplayer_runtime;
grant select, insert on brain_private.evidence_memory_events to multiplayer_runtime;

drop policy if exists brain_runtime_insights_access on brain_private.insights;
create policy brain_runtime_insights_access on brain_private.insights
  for all to multiplayer_runtime using (true) with check (true);
drop policy if exists brain_runtime_evidence_access on brain_private.evidence_memory_events;
create policy brain_runtime_evidence_access on brain_private.evidence_memory_events
  for all to multiplayer_runtime using (true) with check (true);
