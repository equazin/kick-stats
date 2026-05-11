-- Run this in Supabase SQL Editor.
-- Keeps public voting available, but reserves destructive vote actions for admins.

create extension if not exists pgcrypto;

do $$
begin
  create type public.vote_type as enum ('mvp', 'goal');
exception
  when duplicate_object then null;
end $$;

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
