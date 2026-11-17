# Live rooms: Supabase setup and test plan

Live rooms need a free Supabase project. Supabase gives us a Postgres database, Realtime
(pushes changes to every browser in a room) and anonymous sign-in (friends join with just a name).
Vercel still only serves the static page.

Until `memory-poker/js/config.js` has your project's URL and key, live rooms run in
**local test mode**: rooms only exist in one browser, and you play against yourself in several tabs.

## 1. Create the project (once)

1. supabase.com → **New project**.
   - Name: `memory-poker`. Region: the one closest to you and your friends. Plan: **Free**.
   - Database password: let Supabase generate it and keep it somewhere safe. The game never uses it.
2. **Authentication → Sign In / Providers → Allow anonymous sign-ins: ON.**
   Each browser gets a hidden user ID on first visit. That's how the database knows which
   player row belongs to whom, and why a refreshed tab is still the same player.
   - Supabase limits new anonymous sign-ins to 30 per hour per IP address (changeable under
     Authentication → Rate Limits). Each browser signs in once and keeps its session, so a
     group of friends won't hit this.

## 2. Create the tables, rules and functions (once)

1. **SQL Editor → New query.**
2. Paste all of [`supabase/schema.sql`](../supabase/schema.sql) and press **Run**.
   It's safe to run again later; it updates functions and rules without deleting data.

What it creates:

| Thing | Purpose |
|---|---|
| `rooms` table | One row per room: 5-letter code, seed, 8/16, status (`lobby` / `playing` / `reveal`), round number, `start_at`, host. |
| `players` table | One row per player per room: name, the round they joined, this round's markers + hand + lock-in time, total points. |
| Column permissions + Row Level Security | Anyone signed in can read rooms and players. You can only add, change or delete **your own** player row, and only these columns: name, markers, hand, lock-in time. Nobody can change points or rooms directly. |
| `server_now()` | Returns the server's clock. Each browser asks 3 times and keeps the fastest answer, then uses the difference for all timers, so a phone with a wrong clock still flips at the same moment. |
| `start_round(room, seed)` | Host only. Needs at least 2 players. Sets the new seed, adds 1 to the round and sets `start_at` = server time + 5 seconds. |
| `finish_round(room)` | Any player may call it. It acts once per round: when everyone in the round has locked in, or at the deadline: `start_at` + memorize (30s for 8 cards, 60s for 16) + 30s to lock in + 2s grace (`round_deadline()`). Gives 3 / 2 / 1 points to the top three hands, then sets status to `reveal`. |
| Triggers | New players joining mid-round sit out until the next round. A result can only be written for the current round, before the deadline. |
| Realtime publication | Sends `rooms` and `players` changes to browsers subscribed to that room. |
| Cleanup job (pg_cron, free) | Every hour at :17, deletes rooms older than 24 hours (players go with them). |

### Is the key safe to publish?

Yes. The **publishable** key (`sb_publishable_…`, called the **anon** key on older projects) is
meant to be in public web pages. On its own it can only do what the rules above allow.
Never put the **secret** key (`sb_secret_…` / `service_role`) in the site. It skips all the rules.

## 3. Connect the game

1. **Project Settings → API Keys.** Copy the **Project URL** and the **Publishable key**.
2. Put them in `memory-poker/js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
3. Commit and push. Vercel deploys it.

To force local test mode anyway (e.g. while developing), add `&backend=local` to a room link,
or `?backend=local` to the page address before you click Play with friends.

## 4. Test plan (two browser windows + your phone)

Use the Vercel preview URL for the `live-rooms` branch first, then production after merging.

**Setup**
- Window A: normal Chrome window. Window B: a private/incognito window (a different browser
  session = a different player). Phone: on mobile data or Wi-Fi.

**Lobby**
1. A: Play with friends → 8 cards → name "Host" → Create room. You see a 5-letter code and Start is disabled.
2. A: Copy link. Open it in B → enter "Bee" → Join. Both windows list Host and Bee with green dots within ~1 second. Start is now enabled in A.
3. Phone: open the home page, type the code under "Have a room code?" → name "Phone" → Join. All three see three players.
4. Close the B window. Within a few seconds its dot goes grey in A and on the phone. Reopen the link in a new private window: it asks for a name again (a new private window = new player). Join as "Bee2".

**Round**
5. A: Start. All screens show "Get ready — memorizing starts in 5…" and then the same 8 cards at the same moment. The countdowns match to within a second.
6. Phone: lock your phone screen for ~10 seconds during memorize, then unlock. The countdown jumps to the right number (it's worked out from the server clock, not counted).
7. At 0, all flip together. A 30-second lock-in countdown starts.
8. A: lock in fast. A shows "Locked in ✓ — waiting for 2 more players". No one sees anyone's hand yet.
9. Phone: lock in. A shows "waiting for 1 more player".
10. Bee2: don't lock in. At 0, Bee2 sees "Time's up". About 2 seconds later all three see the results.

**Results**
11. The table is in the same order everywhere: best hand first, then faster lock-in. Bee2 is last with "No hand". Points are +3 / +2, totals match. "Best possible" is the same on all screens.
12. Only A (the host) sees "Next round".

**More rounds, refresh, late join**
13. A: Next round. New cards on all screens. Everyone locks in quickly: results appear as soon as the last person locks in, without waiting for the timer.
14. During memorize, refresh the phone. It comes back into the same round without asking for a name, with the right countdown.
15. During a round, open the room link in a third private window and join as "Late". It says it will join from the next round. When A starts the next round, Late plays.
16. Totals keep adding up across rounds.

**Leaving and expiry**
17. Phone: Leave room. It goes back to home, and it disappears from the others' list.
18. Open a made-up code (e.g. `?room=ZZZZZ`). It says the room wasn't found.

## 5. Stats, analytics and keep-awake

**Game counts (Supabase).** SQL Editor → New query, then save it as "Memory Poker stats":
```sql
-- Last 30 days, newest first (days are Chicago time)
select * from daily_stats order by day desc limit 30;

-- Totals
select sum(solo_games) as solo_games, sum(rooms_created) as rooms, sum(players_joined) as live_players,
       sum(rounds_played) as live_rounds, sum(live_hands) as live_hands
from daily_stats;
```
Unique live players per month: **Authentication → Users** (each browser is one anonymous user), or the
"Monthly active users" figure on the project's **Usage** page.

**Page views (Vercel Web Analytics, free, no cookies).** The page already includes the script.
Turn it on in Vercel: open the **juileebhosale-website** project → **Analytics** → **Enable**.
(Visits to juileebhosale.com/memory-poker are counted there, as the path `/memory-poker`.)
Optional: do the same in the **memory-poker** project to count visits to the `.vercel.app` address.

**Keep-awake.** Free Supabase projects are paused after a week with no activity.
`.github/workflows/keep-supabase-awake.yml` asks the database for the time every 3 days.
Check it once: GitHub → repo → **Actions** → **Keep Supabase awake** → **Run workflow**; it should go green.
GitHub stops scheduled jobs after 60 days with no commits (it emails first); if so, click **Enable workflow** there.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| "Live rooms are not set up yet (anonymous sign-ins are off)" | Step 1.2 wasn't done. |
| "permission denied" or "relation does not exist" | The SQL in step 2 wasn't run, or failed partway. Run it again. |
| Players don't appear until refresh | Realtime publication missing. Run the SQL again. Check **Database → Publications → supabase_realtime** lists `rooms` and `players`. |
| Countdowns differ by several seconds | One device couldn't reach `server_now()`. Check the browser console for errors. |
| Banner says "Local test mode" on the live site | `config.js` is empty, or the link has `backend=local`. |
| "This room is full (12 players max)" | By design. Change the limit in `schema.sql` (`>= 12`) and `MAX_PLAYERS` in `liveRules.js`, then re-run the SQL. |
| "Please choose a different name" for a normal name | The filter caught part of it. Add the word to `ALLOWED` in `nameFilter.js` and `allowed` in `name_is_blocked()`, then re-run the SQL. |
| Supabase project paused | Open the project in the dashboard and click **Restore**. Then check the keep-awake job is enabled. |
