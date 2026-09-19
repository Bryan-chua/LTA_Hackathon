alter table notification_installations
  add column if not exists last_test_push_at timestamptz;

alter table notification_installations enable row level security;
alter table evaluation_profiles enable row level security;
alter table notification_decisions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on notification_installations, evaluation_profiles, notification_decisions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on notification_installations, evaluation_profiles, notification_decisions from authenticated;
  end if;
end
$$;

comment on column notification_installations.last_test_push_at is
  'Server-enforced timestamp for the five-minute installation-owned test-push cooldown.';
