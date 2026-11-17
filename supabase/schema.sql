-- Memory Poker: live rooms
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again: it updates functions/policies in place and doesn't drop data.
--
-- Who can do what (enforced here, not in the browser):
--   * Everyone signed in (friends use anonymous sign-in) can READ rooms and players.
--   * Anyone signed in can CREATE a room; they become its host.
--   * A player can only add, change or delete THEIR OWN player row (only certain columns).
--   * Only the host can start a round (start_round). Rooms can't be edited directly.
--   * Points are only ever changed by finish_round, never by a browser.
--   * Rooms hold at most 12 players; at most 10 new rooms per person per hour; names are filtered.
--   * daily_stats keeps simple daily counts that only you can read.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id            text primary key check (id ~ '^[A-HJ-NP-Z]{5}$'),       -- 5 letters, no I/O
  seed          text not null check (char_length(seed) between 1 and 32),
  n             smallint not null check (n in (8, 16)),
  status        text not null default 'lobby' check (status in ('lobby', 'playing', 'reveal')),
  round         int not null default 0,
  start_at      timestamptz,                                              -- when memorizing starts
  host_user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scored_round  int not null default 0,                                   -- last round points were given for
  created_at    timestamptz not null default now()
);

create table if not exists public.players (
  id             uuid primary key default gen_random_uuid(),
  room_id        text not null references public.rooms (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 20),
  joined_round   int not null default 1,     -- first round this player takes part in (set by trigger)
  round          int,                        -- round the result columns below belong to
  marker_a       smallint check (marker_a between 0 and 15),
  marker_b       smallint check (marker_b between 0 and 15),
  hand_category  smallint check (hand_category between 0 and 8),
  hand_tiebreak  smallint[],
  lock_in_ms     int check (lock_in_ms >= 0),
  points         int not null default 0,
  last_seen      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (room_id, user_id),
  check (marker_a is null or marker_a <> marker_b)
);

create index if not exists players_room_id_idx on public.players (room_id);

-- ---------------------------------------------------------------------------
-- Column-level permissions (what the browser may write at all)
-- ---------------------------------------------------------------------------

revoke all on public.rooms, public.players from anon, authenticated;

grant select on public.rooms, public.players to authenticated;
grant insert (id, seed, n) on public.rooms to authenticated;
grant insert (room_id, name) on public.players to authenticated;
grant update (name, round, marker_a, marker_b, hand_category, hand_tiebreak, lock_in_ms, last_seen)
  on public.players to authenticated;
grant delete on public.players to authenticated;  -- "Leave room"

-- ---------------------------------------------------------------------------
-- Row Level Security (which rows)
-- ---------------------------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.players enable row level security;

drop policy if exists "rooms: anyone signed in can read" on public.rooms;
create policy "rooms: anyone signed in can read" on public.rooms
  for select to authenticated using (true);

drop policy if exists "rooms: create as yourself (host)" on public.rooms;
create policy "rooms: create as yourself (host)" on public.rooms
  for insert to authenticated with check (host_user_id = (select auth.uid()));

drop policy if exists "players: anyone signed in can read" on public.players;
create policy "players: anyone signed in can read" on public.players
  for select to authenticated using (true);

drop policy if exists "players: join as yourself" on public.players;
create policy "players: join as yourself" on public.players
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "players: update only your own row" on public.players;
create policy "players: update only your own row" on public.players
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "players: leave (delete your own row)" on public.players;
create policy "players: leave (delete your own row)" on public.players
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Limits for sharing with strangers (keep in step with liveRules.js / nameFilter.js)
--   * at most 12 players per room
--   * at most 10 new rooms per person per hour
--   * player names go through a small blocked-words filter
-- ---------------------------------------------------------------------------

-- Same lists and rules as memory-poker/js/nameFilter.js.
create or replace function public.name_is_blocked(p_name text)
returns boolean
language plpgsql
immutable
as $$
declare
  anywhere text[] := array['nigger', 'nigga', 'faggot', 'retard', 'tranny', 'kike', 'chink', 'wetback', 'beaner', 'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'asshole', 'bastard', 'rapist', 'hitler', 'nazi', 'porn', 'penis', 'vagina', 'dildo'];
  whole    text[] := array['fag', 'spic', 'dick', 'cock', 'sex', 'ass', 'tit', 'tits', 'kkk', 'cum', 'rape'];
  allowed  text[] := array['scunthorpe', 'therapist', 'shitake', 'shiitake', 'cockburn'];
  words    text[];
  pieces   text[] := '{}';
  w        text;
  run      text := '';
begin
  -- lower case, look-alike symbols to letters ("sh1t" -> "shit"), split into words
  words := array_remove(
    regexp_split_to_array(translate(lower(coalesce(p_name, '')), '0134578@$!', 'oieastbasi'), '[^a-z]+'),
    '');
  foreach w in array words || array['']::text[] loop   -- '' at the end flushes the last run
    if w = any(whole) then return true; end if;
    if char_length(w) = 1 then
      run := run || w;                                  -- "f u c k" -> "fuck"
    else
      if char_length(run) > 1 then pieces := pieces || run; end if;
      run := '';
      if w <> '' and not (w = any(allowed)) then pieces := pieces || w; end if;
    end if;
  end loop;
  foreach w in array pieces loop
    if w = any(whole) then return true; end if;
    if exists (select 1 from unnest(anywhere) a where position(a in w) > 0) then return true; end if;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily stats (only you can read them: SQL Editor, or Table Editor -> daily_stats)
-- Days are in Chicago time. Rooms are deleted after 24h; these counts are kept.
-- ---------------------------------------------------------------------------

create table if not exists public.daily_stats (
  day             date primary key,
  solo_games      int not null default 0,   -- solo games finished (locked in)
  rooms_created   int not null default 0,
  players_joined  int not null default 0,   -- player rows created in live rooms
  rounds_played   int not null default 0,   -- live rounds started
  live_hands      int not null default 0    -- live hands locked in (counted when a round ends)
);

revoke all on public.daily_stats from anon, authenticated;
alter table public.daily_stats enable row level security;   -- no policies: not readable from the browser

create or replace function public.bump_stat(p_col text, p_by int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_col not in ('solo_games', 'rooms_created', 'players_joined', 'rounds_played', 'live_hands') then
    raise exception 'Unknown stat %', p_col;
  end if;
  if p_by is null or p_by <= 0 then return; end if;
  execute format(
    'insert into public.daily_stats (day, %1$I) values ((now() at time zone ''America/Chicago'')::date, $1)
     on conflict (day) do update set %1$I = public.daily_stats.%1$I + excluded.%1$I', p_col)
  using p_by;
end;
$$;

revoke all on function public.bump_stat(text, int) from public, anon, authenticated;

-- Called by the page when someone finishes a solo game. No sign-in needed; it can only add 1.
create or replace function public.record_solo_game()
returns void
language sql
security definer
set search_path = public
as $$ select public.bump_stat('solo_games', 1) $$;

revoke all on function public.record_solo_game() from public;
grant execute on function public.record_solo_game() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Timing (keep in step with memorizeMs() in memory-poker/js/liveRules.js)
-- ---------------------------------------------------------------------------

-- Seconds to memorize: 30 for 8 cards, 60 for 16.
create or replace function public.memorize_seconds(p_n smallint)
returns int
language sql
immutable
as $$ select case p_n when 8 then 30 else 60 end $$;

-- Last moment a result is accepted: start + memorize + 30s to lock in + 2s for slow networks.
create or replace function public.round_deadline(p_start timestamptz, p_n smallint)
returns timestamptz
language sql
immutable
as $$ select p_start + make_interval(secs => public.memorize_seconds(p_n) + 30 + 2) $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- New players sit out a round already in progress: they start at the next round.
create or replace function public.set_joined_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select r.round + 1 into new.joined_round from public.rooms r where r.id = new.room_id;
  if new.joined_round is null then
    raise exception 'Room % not found', new.room_id;
  end if;
  new.name := btrim(new.name);
  if public.name_is_blocked(new.name) then
    raise exception 'Please choose a different name.';
  end if;
  if (select count(*) from public.players where room_id = new.room_id) >= 12 then
    raise exception 'This room is full (12 players max).';
  end if;
  return new;
end;
$$;

drop trigger if exists players_set_joined_round on public.players;
create trigger players_set_joined_round
  before insert on public.players
  for each row execute function public.set_joined_round();

-- A result can only be written for the current round, while it's running,
-- and before the lock-in deadline (see round_deadline: memorize + 30s place + 2s grace).
create or replace function public.check_result_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms;
begin
  if (new.round, new.marker_a, new.marker_b, new.hand_category, new.hand_tiebreak, new.lock_in_ms)
     is distinct from
     (old.round, old.marker_a, old.marker_b, old.hand_category, old.hand_tiebreak, old.lock_in_ms) then
    select * into r from public.rooms where id = new.room_id;
    if r.status <> 'playing' or new.round is distinct from r.round then
      raise exception 'No round is running';
    end if;
    if clock_timestamp() > public.round_deadline(r.start_at, r.n) then
      raise exception 'Too late to lock in';
    end if;
    if new.round < new.joined_round then
      raise exception 'You join from the next round';
    end if;
  end if;
  new.name := btrim(new.name);
  if new.name is distinct from old.name and public.name_is_blocked(new.name) then
    raise exception 'Please choose a different name.';
  end if;
  return new;
end;
$$;

drop trigger if exists players_check_result_timing on public.players;
create trigger players_check_result_timing
  before update on public.players
  for each row execute function public.check_result_timing();

-- At most 10 new rooms per person per hour.
create or replace function public.limit_rooms_per_hour()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.rooms
       where host_user_id = new.host_user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve made a lot of rooms in the last hour. Please try again later.';
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_limit_per_hour on public.rooms;
create trigger rooms_limit_per_hour
  before insert on public.rooms
  for each row execute function public.limit_rooms_per_hour();

-- Stats: count new rooms and new players.
create or replace function public.count_new_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bump_stat(tg_argv[0], 1);
  return null;
end;
$$;

drop trigger if exists rooms_count_created on public.rooms;
create trigger rooms_count_created
  after insert on public.rooms
  for each row execute function public.count_new_row('rooms_created');

drop trigger if exists players_count_joined on public.players;
create trigger players_count_joined
  after insert on public.players
  for each row execute function public.count_new_row('players_joined');

-- ---------------------------------------------------------------------------
-- Functions the browser calls
-- ---------------------------------------------------------------------------

-- Server clock, for syncing timers across devices.
create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select clock_timestamp() $$;

grant execute on function public.server_now() to anon, authenticated;

-- Host starts round 1 (from the lobby) or the next round (from the reveal screen).
-- Memorizing starts 5 seconds from now, by the server's clock.
create or replace function public.start_round(p_room text, p_seed text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then
    raise exception 'Room not found';
  end if;
  if r.host_user_id is distinct from auth.uid() then
    raise exception 'Only the host can start a round';
  end if;
  if r.status = 'playing' then
    raise exception 'A round is already running';
  end if;
  if (select count(*) from public.players where room_id = p_room) < 2 then
    raise exception 'Need at least 2 players';
  end if;
  if p_seed is null or char_length(p_seed) not between 1 and 32 then
    raise exception 'Bad seed';
  end if;

  update public.rooms
     set seed = p_seed,
         round = r.round + 1,
         status = 'playing',
         start_at = clock_timestamp() + interval '5 seconds'
   where id = p_room
  returning * into r;
  perform public.bump_stat('rounds_played', 1);
  return r;
end;
$$;

revoke all on function public.start_round(text, text) from public, anon;
grant execute on function public.start_round(text, text) to authenticated;

-- End the round once everyone has locked in, or the time is up.
-- Any player in the room may call it; it only acts once per round.
-- Gives 3 / 2 / 1 points to the top three hands.
-- Order (keep in step with rankRound in js/liveRules.js):
--   best hand category, then tiebreak cards high to low, then faster lock-in, then name, then id.
create or replace function public.finish_round(p_room text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms;
  v_all_in boolean;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then
    raise exception 'Room not found';
  end if;
  if not exists (select 1 from public.players where room_id = p_room and user_id = auth.uid()) then
    raise exception 'Not a player in this room';
  end if;
  if r.status <> 'playing' then
    return r.status;
  end if;

  select coalesce(bool_and(p.round is not distinct from r.round and p.hand_category is not null), false)
    into v_all_in
    from public.players p
   where p.room_id = p_room and p.joined_round <= r.round;

  if not v_all_in and clock_timestamp() < public.round_deadline(r.start_at, r.n) then
    return 'waiting';
  end if;

  with ranked as (
    select p.id,
           row_number() over (
             order by p.hand_category desc, p.hand_tiebreak desc, p.lock_in_ms asc,
                      p.name collate "C" asc, p.id asc
           ) as rn
      from public.players p
     where p.room_id = p_room
       and p.joined_round <= r.round
       and p.round = r.round
       and p.hand_category is not null
  )
  update public.players p
     set points = p.points + case ranked.rn when 1 then 3 when 2 then 2 else 1 end
    from ranked
   where p.id = ranked.id and ranked.rn <= 3;

  update public.rooms set status = 'reveal', scored_round = r.round where id = p_room;
  perform public.bump_stat('live_hands',
    (select count(*)::int from public.players p
      where p.room_id = p_room and p.round = r.round and p.hand_category is not null));
  return 'reveal';
end;
$$;

revoke all on function public.finish_round(text) from public, anon;
grant execute on function public.finish_round(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: send row changes for these tables to subscribed browsers
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup: delete rooms older than 24 hours, every hour (players go with them)
-- pg_cron is available on the Free plan.
-- ---------------------------------------------------------------------------

-- If pg_cron can't be switched on here, the rest of this script still works:
-- you'll see a NOTICE, and you can enable it under Database -> Extensions -> pg_cron, then run this file again.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'Skipped cleanup job: could not enable pg_cron (%). Enable it under Database -> Extensions, then re-run.', sqlerrm;
    return;
  end;
  -- Same job name = replaces the old schedule on re-run. Every hour at :17.
  execute $cmd$
    select cron.schedule(
      'memory-poker-cleanup',
      '17 * * * *',
      $job$ delete from public.rooms where created_at < now() - interval '24 hours' $job$
    )
  $cmd$;
end;
$$;

-- Optional: also remove old anonymous users (friends who haven't played in 30 days).
-- Uncomment to enable. Their old player rows are deleted with them.
-- select cron.schedule(
--   'memory-poker-cleanup-anon-users',
--   '23 4 * * *',
--   $$ delete from auth.users where is_anonymous and last_sign_in_at < now() - interval '30 days' $$
-- );
