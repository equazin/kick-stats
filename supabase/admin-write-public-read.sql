-- ===============================================================
-- Public read + admin-only write
-- Run this in Supabase SQL Editor for project hlafffjpmnvrqttiqrqw
-- ===============================================================

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.match_status as enum ('pendiente', 'jugado', 'cerrado');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.team_side as enum ('A', 'B');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.player_position as enum ('arquero', 'defensor', 'mediocampista', 'delantero');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.vote_type as enum ('mvp', 'goal');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apodo text,
  posicion public.player_position,
  foto_url text,
  fecha_alta timestamptz not null default now(),
  activo boolean not null default true,
  elo numeric not null default 1000,
  tipo text not null default 'titular',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.players
  add column if not exists apodo text,
  add column if not exists posicion public.player_position,
  add column if not exists foto_url text,
  add column if not exists fecha_alta timestamptz not null default now(),
  add column if not exists activo boolean not null default true,
  add column if not exists elo numeric not null default 1000,
  add column if not exists tipo text not null default 'titular',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null,
  equipo_a_score integer not null default 0 check (equipo_a_score >= 0),
  equipo_b_score integer not null default 0 check (equipo_b_score >= 0),
  mvp_player_id uuid references public.players(id) on delete set null,
  gol_de_la_fecha_player_id uuid references public.players(id) on delete set null,
  estado public.match_status not null default 'pendiente',
  votacion_abre timestamptz,
  votacion_cierra timestamptz,
  notas text,
  is_friendly boolean not null default false,
  elo_applied boolean not null default false,
  elo_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.matches
  add column if not exists equipo_a_score integer not null default 0,
  add column if not exists equipo_b_score integer not null default 0,
  add column if not exists mvp_player_id uuid references public.players(id) on delete set null,
  add column if not exists gol_de_la_fecha_player_id uuid references public.players(id) on delete set null,
  add column if not exists estado public.match_status not null default 'pendiente',
  add column if not exists votacion_abre timestamptz,
  add column if not exists votacion_cierra timestamptz,
  add column if not exists notas text,
  add column if not exists is_friendly boolean not null default false,
  add column if not exists elo_applied boolean not null default false,
  add column if not exists elo_applied_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_matches_fecha on public.matches(fecha desc);
create index if not exists idx_matches_estado on public.matches(estado);

create table if not exists public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  equipo public.team_side not null,
  goles integer not null default 0 check (goles >= 0),
  asistencias integer not null default 0 check (asistencias >= 0),
  calificacion numeric(3,1) check (calificacion is null or (calificacion >= 1 and calificacion <= 10)),
  presente boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create index if not exists idx_match_players_match on public.match_players(match_id);
create index if not exists idx_match_players_player on public.match_players(player_id);

create table if not exists public.fund_movements (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto integer not null check (monto > 0),
  motivo text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  voter_player_id uuid not null references public.players(id) on delete cascade,
  voted_player_id uuid not null references public.players(id) on delete cascade,
  type public.vote_type not null,
  created_at timestamptz not null default now(),
  check (voter_player_id <> voted_player_id),
  unique (match_id, voter_player_id, type)
);

create index if not exists idx_votes_match_type on public.votes(match_id, type);

-- Tables controlled by admin only for writes
alter table if exists public.players enable row level security;
alter table if exists public.matches enable row level security;
alter table if exists public.match_players enable row level security;
alter table if exists public.goal_events enable row level security;
alter table if exists public.contributions enable row level security;
alter table if exists public.fines enable row level security;
alter table if exists public.fund_movements enable row level security;
alter table if exists public.votes enable row level security;

-- Remove permissive/open policies
drop policy if exists open_all_players on public.players;
drop policy if exists open_all_matches on public.matches;
drop policy if exists open_all_match_players on public.match_players;
drop policy if exists open_all_goal_events on public.goal_events;
drop policy if exists open_all_contributions on public.contributions;
drop policy if exists open_all_fines on public.fines;
drop policy if exists open_all_fund_movements on public.fund_movements;
drop policy if exists open_all_votes on public.votes;

drop policy if exists public_read_players on public.players;
drop policy if exists public_read_matches on public.matches;
drop policy if exists public_read_match_players on public.match_players;
drop policy if exists public_read_goal_events on public.goal_events;
drop policy if exists public_read_contributions on public.contributions;
drop policy if exists public_read_fines on public.fines;
drop policy if exists public_read_fund_movements on public.fund_movements;
drop policy if exists public_read_votes on public.votes;
drop policy if exists public_insert_votes on public.votes;
drop policy if exists public_update_votes on public.votes;

drop policy if exists admin_write_players on public.players;
drop policy if exists admin_write_matches on public.matches;
drop policy if exists admin_write_match_players on public.match_players;
drop policy if exists admin_write_goal_events on public.goal_events;
drop policy if exists admin_write_contributions on public.contributions;
drop policy if exists admin_write_fines on public.fines;
drop policy if exists admin_write_fund_movements on public.fund_movements;
drop policy if exists admin_delete_votes on public.votes;

-- Read for everyone (anon + authenticated)
create policy public_read_players on public.players
  for select using (true);
create policy public_read_matches on public.matches
  for select using (true);
create policy public_read_match_players on public.match_players
  for select using (true);
create policy public_read_goal_events on public.goal_events
  for select using (true);
create policy public_read_contributions on public.contributions
  for select using (true);
create policy public_read_fines on public.fines
  for select using (true);
create policy public_read_fund_movements on public.fund_movements
  for select using (true);
create policy public_read_votes on public.votes
  for select using (true);
create policy public_insert_votes on public.votes
  for insert with check (true);
create policy public_update_votes on public.votes
  for update using (true) with check (true);

-- Write only for admin emails
-- Add more emails here when needed.
create policy admin_write_players on public.players
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_matches on public.matches
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_match_players on public.match_players
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_goal_events on public.goal_events
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_contributions on public.contributions
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_fines on public.fines
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_write_fund_movements on public.fund_movements
  for all
  using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  )
  with check (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

create policy admin_delete_votes on public.votes
  for delete using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );

commit;
