create extension if not exists pgcrypto;

create table if not exists notification_installations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  push_endpoint text not null unique,
  push_p256dh text not null,
  push_auth text not null,
  timezone text not null default 'Asia/Singapore' check (timezone = 'Asia/Singapore'),
  consented_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists evaluation_profiles (
  installation_id bigint primary key references notification_installations(id) on delete cascade,
  origin_lat double precision not null check (origin_lat between 1.1 and 1.5),
  origin_lng double precision not null check (origin_lng between 103.5 and 104.1),
  destination_lat double precision not null check (destination_lat between 1.1 and 1.5),
  destination_lng double precision not null check (destination_lng between 103.5 and 104.1),
  departure_time time not null,
  arrival_deadline time not null,
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7),
  material_delay_minutes smallint not null default 10 check (material_delay_minutes between 5 and 60),
  enabled boolean not null default true,
  version_hash text not null check (length(version_hash) = 64),
  next_check_at timestamptz,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint evaluation_profiles_deadline_check check (arrival_deadline > departure_time),
  constraint evaluation_profiles_places_check check (origin_lat <> destination_lat or origin_lng <> destination_lng),
  constraint evaluation_profiles_weekdays_check check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists notification_decisions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  installation_id bigint not null references notification_installations(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) = 64),
  result text not null check (result in ('no_action', 'action_required', 'recovery', 'failed')),
  reason_codes text[] not null default '{}',
  title text,
  body text,
  target_url text,
  evaluated_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null,
  unique (installation_id, fingerprint)
);

create index if not exists notification_decisions_installation_evaluated_idx
  on notification_decisions (installation_id, evaluated_at desc);
create index if not exists evaluation_profiles_due_idx
  on evaluation_profiles (next_check_at)
  where enabled and next_check_at is not null;
create index if not exists notification_installations_active_idx
  on notification_installations (last_seen_at)
  where disabled_at is null;

comment on table evaluation_profiles is 'Opt-in minimized commute evaluation data; no names, address labels, GPS history, or contacts.';
comment on column notification_installations.push_endpoint is 'Sensitive Web Push capability URL; never log or expose to other installations.';
