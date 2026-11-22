begin;

-- Core v1: apply as project owner, never from the browser/runtime role.
create schema if not exists core_private;
revoke all on schema core_private from public, anon, authenticated;
grant usage on schema core_private to multiplayer_runtime, service_role;

create table if not exists core_private.engine_versions (
  id text primary key, label text not null, archived boolean not null default false,
  source_commit text, configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
insert into core_private.engine_versions(id,label,archived,source_commit) values
 ('pasture-legacy-20261122','Archived pasture logic',true,'ca738e9a59064fe27d9c7b71cd9e51e8dd46a640'),
 ('core-v1','Core',false,null) on conflict(id) do nothing;

create table if not exists core_private.decision_snapshots (
  id text primary key check(length(id) between 1 and 200),
  account_id text not null references multiplayer_private.accounts(account_id),
  engine_version text not null references core_private.engine_versions(id),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  created_at timestamptz not null default now(),
  unique(account_id,id)
);
create index if not exists core_decisions_account_time on core_private.decision_snapshots(account_id,created_at desc);

create table if not exists core_private.execution_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references multiplayer_private.accounts(account_id),
  decision_id text references core_private.decision_snapshots(id),
  contract_id uuid references multiplayer_private.contracts(id),
  provider_contract_id text,
  source text not null check(source in ('manual','auto','brain')),
  status text not null,
  ask numeric, payout numeric, reason text,
  created_at timestamptz not null default now()
);
create index if not exists core_attempts_account_time on core_private.execution_attempts(account_id,created_at desc);
create index if not exists core_attempts_contract on core_private.execution_attempts(account_id,contract_id);

create table if not exists core_private.lesson_rules (
  id uuid primary key default gen_random_uuid(), version integer not null default 1 check(version>0),
  account_id text not null references multiplayer_private.accounts(account_id),
  source_trade_id uuid not null references multiplayer_private.contracts(id),
  legacy_insight_id uuid references brain_private.insights(id),
  market_symbol text not null, expected_direction text not null check(expected_direction in ('over','under')),
  barrier smallint not null check(barrier between 0 and 9), mode text not null check(mode in ('demo','real')),
  stance text not null check(stance in ('good','warning')), conditions jsonb not null check(jsonb_typeof(conditions)='object'),
  note text not null default '', confidence smallint not null check(confidence between 1 and 5),
  created_at timestamptz not null default now(), unique(account_id,source_trade_id), unique(legacy_insight_id)
);
create index if not exists core_rules_account_time on core_private.lesson_rules(account_id,created_at desc);

create table if not exists core_private.lesson_evaluations (
  rule_id uuid not null references core_private.lesson_rules(id), rule_version integer not null,
  trade_id uuid not null references multiplayer_private.contracts(id),
  account_id text not null references multiplayer_private.accounts(account_id),
  classification text not null check(classification in ('matched','comparison','skipped')),
  reason text not null, matched_conditions jsonb not null,
  won boolean, profit numeric, stake numeric, trade_created_at timestamptz not null,
  evaluated_at timestamptz not null default now(),
  primary key(rule_id,rule_version,trade_id)
);
create index if not exists core_evaluations_account_rule on core_private.lesson_evaluations(account_id,rule_id,rule_version,classification);

create table if not exists core_private.research_runs (
  id text primary key, account_id text not null references multiplayer_private.accounts(account_id),
  engine_version text not null default 'core-v1' references core_private.engine_versions(id),
  state jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists core_research_account_time on core_private.research_runs(account_id,created_at desc);
create table if not exists core_private.research_results (
  id text primary key, run_id text not null references core_private.research_runs(id),
  account_id text not null references multiplayer_private.accounts(account_id),
  result jsonb not null, created_at timestamptz not null default now()
);
create index if not exists core_research_results_run on core_private.research_results(account_id,run_id,created_at desc);

-- Restart-safe evidence jobs: no quote/purchase waits for a job.
create table if not exists core_private.evidence_jobs (
  account_id text primary key references multiplayer_private.accounts(account_id),
  requested_at timestamptz not null default now(), attempts integer not null default 0,
  available_at timestamptz not null default now(), last_error text
);

do $$
declare t text;
begin
  foreach t in array array['engine_versions','decision_snapshots','execution_attempts','lesson_rules','lesson_evaluations','research_runs','research_results','evidence_jobs'] loop
    execute format('alter table core_private.%I enable row level security',t);
    execute format('revoke all on core_private.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on core_private.%I to multiplayer_runtime,service_role',t);
    if not exists(select 1 from pg_policies where schemaname='core_private' and tablename=t and policyname='core_runtime_access') then
      execute format('create policy core_runtime_access on core_private.%I for all to multiplayer_runtime using(true) with check(true)',t);
    end if;
  end loop;
end $$;

-- Runtime snapshots and rule versions are append-only evidence.
revoke update,delete on core_private.engine_versions,core_private.decision_snapshots,core_private.execution_attempts,core_private.lesson_rules from multiplayer_runtime;
revoke insert on core_private.engine_versions from multiplayer_runtime;

commit;

