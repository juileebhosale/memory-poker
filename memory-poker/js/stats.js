// Count a finished solo game in Supabase (daily_stats.solo_games). Fire and forget:
// no library, no sign-in, never blocks or breaks the game if it fails.
// Skipped on localhost and in local test mode so testing doesn't inflate the numbers.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export function recordSoloGame() {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const { hostname, search } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return;
    if (new URLSearchParams(search).get('backend') === 'local') return;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/record_solo_game`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
