-- ===============================================================
-- Public read + admin-only write
-- Run this in Supabase SQL Editor for project hlafffjpmnvrqttiqrqw
-- ===============================================================

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.vote_type as enum ('mvp', 'goal');
exception
  when duplicate_object then null;
end $$;

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
