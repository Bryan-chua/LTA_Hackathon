create table if not exists forecast_installations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  consented_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists journey_forecast_observations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  installation_id bigint not null references forecast_installations(id) on delete cascade,
  observation_fingerprint text not null check (length(observation_fingerprint) = 64),
  route_signature text not null check (length(route_signature) = 64),
  departure_bucket time not null,
  feature_schema_version text not null,
  model_version text,
  method text not null check (method in ('model', 'synthetic_model', 'deterministic_fallback')),
  features jsonb not null check (jsonb_typeof(features) = 'object'),
  forecast jsonb not null check (jsonb_typeof(forecast) = 'object'),
  arrived_before_deadline boolean,
  actual_arrival time,
  took_recommended boolean,
  label_source text check (label_source is null or label_source = 'user_feedback'),
  labelled_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  unique (installation_id, observation_fingerprint)
);

create index if not exists journey_forecast_observations_installation_created_idx
  on journey_forecast_observations (installation_id, created_at desc);
create index if not exists journey_forecast_observations_expiry_idx
  on journey_forecast_observations (expires_at);
create index if not exists journey_forecast_observations_unlabelled_idx
  on journey_forecast_observations (created_at)
  where labelled_at is null;

alter table forecast_installations enable row level security;
alter table journey_forecast_observations enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on forecast_installations, journey_forecast_observations from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on forecast_installations, journey_forecast_observations from authenticated;
  end if;
end
$$;

comment on table journey_forecast_observations is
  'Opt-in pseudonymous point-in-time reliability features and confirmed feedback; no address labels or GPS trails.';
comment on column journey_forecast_observations.route_signature is
  'Non-reversible journey signature. It is pseudonymous, not anonymous.';
