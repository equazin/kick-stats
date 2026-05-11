-- RUN THIS FILE in Supabase SQL Editor.
-- If your SQL says "create type public.match_status ..." without EXECUTE, it is the old file.

create extension if not exists pgcrypto;

do $$
begin
  execute 'create type public.match_status as enum (''pendiente'', ''jugado'', ''cerrado'')';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  execute 'create type public.team_side as enum (''A'', ''B'')';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  execute 'create type public.player_position as enum (''arquero'', ''defensor'', ''mediocampista'', ''delantero'')';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  execute 'create type public.vote_type as enum (''mvp'', ''goal'')';
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

alter table if exists public.votes enable row level security;

drop policy if exists open_all_votes on public.votes;
drop policy if exists public_read_votes on public.votes;
drop policy if exists public_insert_votes on public.votes;
drop policy if exists public_update_votes on public.votes;
drop policy if exists admin_delete_votes on public.votes;

create policy public_read_votes on public.votes
  for select using (true);

create policy public_insert_votes on public.votes
  for insert with check (true);

create policy public_update_votes on public.votes
  for update using (true) with check (true);

create policy admin_delete_votes on public.votes
  for delete using (
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('nicopbenitez84@gmail.com')
  );
