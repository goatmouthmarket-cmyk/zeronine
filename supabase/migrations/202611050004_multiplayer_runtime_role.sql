-- The app uses its own login with access only to the private multiplayer schema.
-- Set its generated password outside this migration; never commit credentials.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'multiplayer_runtime') then
    create role multiplayer_runtime login;
  end if;
end $$;

grant connect on database postgres to multiplayer_runtime;
grant usage on schema multiplayer_private to multiplayer_runtime;
grant select, insert, update, delete on all tables in schema multiplayer_private to multiplayer_runtime;
grant usage, select on all sequences in schema multiplayer_private to multiplayer_runtime;

create policy multiplayer_runtime_access on multiplayer_private.accounts
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.sessions
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.contracts
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.rooms
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.room_members
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.room_messages
  for all to multiplayer_runtime using (true) with check (true);
create policy multiplayer_runtime_access on multiplayer_private.account_risk
  for all to multiplayer_runtime using (true) with check (true);
