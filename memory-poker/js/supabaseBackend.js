// Live rooms backend using Supabase (Postgres + Realtime + anonymous sign-in).
// Same interface as localBackend.js. All rules are enforced by supabase/schema.sql.
// supabase-js is kept in this repo (memory-poker/vendor/, MIT licence) so live rooms
// don't depend on a third-party CDN. It's a classic script that sets window.supabase,
// loaded only when a live room is opened.
const SUPABASE_JS = '/memory-poker/vendor/supabase-js-2.119.0.min.js';

function loadSupabaseJs() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SUPABASE_JS;
    s.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('Supabase library did not load')));
    s.onerror = () => reject(new Error("Couldn't load live rooms. Check your connection and try again."));
    document.head.append(s);
  });
}

// Database row (snake_case) -> object the game uses (camelCase).
function roomFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    seed: r.seed,
    n: r.n,
    status: r.status,
    round: r.round,
    startAt: r.start_at ? Date.parse(r.start_at) : null,
    hostUserId: r.host_user_id,
  };
}

function playerFromRow(p) {
  return {
    id: p.id,
    roomId: p.room_id,
    userId: p.user_id,
    name: p.name,
    joinedRound: p.joined_round,
    round: p.round,
    markerA: p.marker_a,
    markerB: p.marker_b,
    handCategory: p.hand_category,
    handTiebreak: p.hand_tiebreak,
    lockInMs: p.lock_in_ms,
    points: p.points,
  };
}

// Turn a Postgres/PostgREST error into something a player can read.
function friendly(error) {
  const msg = error?.message ?? String(error);
  if (/anonymous sign-ins are disabled/i.test(msg)) return 'Live rooms are not set up yet (anonymous sign-ins are off).';
  if (/rate limit/i.test(msg)) return 'Too many new players from this network. Try again in a while.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Network problem. Check your connection and try again.';
  return msg;
}

function check({ data, error }) {
  if (error) {
    const e = new Error(friendly(error));
    e.code = error.code;
    throw e;
  }
  return data;
}

export async function createSupabaseBackend({ url, key }) {
  const { createClient } = await loadSupabaseJs();
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'memory-poker-auth' },
  });

  // Anonymous sign-in, once per browser. The session is kept in localStorage, so a
  // refreshed tab is the same player.
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const res = await sb.auth.signInAnonymously();
    check(res);
    session = res.data.session;
  }
  const userId = session.user.id;

  return {
    kind: 'supabase',
    userId,

    async serverNowSample() {
      const sentAt = Date.now();
      const data = check(await sb.rpc('server_now'));
      const receivedAt = Date.now();
      return { sentAt, serverNow: Date.parse(data), receivedAt };
    },

    // Returns the room, or null if the code is taken (caller picks another code).
    async createRoom({ id, seed, n }) {
      const res = await sb.from('rooms').insert({ id, seed, n }).select().single();
      if (res.error && res.error.code === '23505') return null; // duplicate code
      return roomFromRow(check(res));
    },

    async getRoom(id) {
      return roomFromRow(check(await sb.from('rooms').select().eq('id', id).maybeSingle()));
    },

    async listPlayers(roomId) {
      const rows = check(await sb.from('players').select().eq('room_id', roomId).order('created_at'));
      return rows.map(playerFromRow);
    },

    // Join, or rejoin with a new name if this browser already has a player in the room.
    async joinRoom(roomId, name) {
      const existing = check(await sb.from('players').select()
        .eq('room_id', roomId).eq('user_id', userId).maybeSingle());
      if (existing) {
        if (existing.name === name) return playerFromRow(existing);
        return playerFromRow(check(await sb.from('players').update({ name })
          .eq('id', existing.id).select().single()));
      }
      return playerFromRow(check(await sb.from('players').insert({ room_id: roomId, name }).select().single()));
    },

    async leaveRoom(playerId) {
      check(await sb.from('players').delete().eq('id', playerId));
    },

    async startRound(roomId, seed) {
      return roomFromRow(check(await sb.rpc('start_round', { p_room: roomId, p_seed: seed })));
    },

    async submitResult(playerId, r) {
      check(await sb.from('players').update({
        round: r.round,
        marker_a: r.markerA,
        marker_b: r.markerB,
        hand_category: r.handCategory,
        hand_tiebreak: r.handTiebreak,
        lock_in_ms: r.lockInMs,
      }).eq('id', playerId));
    },

    async finishRound(roomId) {
      return check(await sb.rpc('finish_round', { p_room: roomId }));
    },

    // Calls onChange() whenever the room or its players change (and once connected),
    // and onPresence(Set of online userIds) when people come and go.
    subscribe(roomId, me, { onChange, onPresence, onStatus }) {
      const channel = sb.channel(`room:${roomId}`, { config: { presence: { key: userId } } });
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => onChange())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, () => onChange())
        .on('presence', { event: 'sync' }, () => onPresence(new Set(Object.keys(channel.presenceState()))))
        .subscribe(async (status) => {
          onStatus?.(status);
          if (status === 'SUBSCRIBED') {
            await channel.track({ name: me.name });
            onChange(); // catch anything missed while connecting
          }
        });
      return () => { sb.removeChannel(channel); };
    },
  };
}
