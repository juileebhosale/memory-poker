// Basic filter for player names that strangers will see. Pure, no DOM.
// The same lists live in supabase/schema.sql (public.name_is_blocked); keep them in step.
// The database check is the one that counts; this one gives a friendly message first.
//
// It's deliberately small: it catches the obvious slurs and swear words, including
// simple disguises like "f.u.c.k" or "sh1t". It won't catch everything.

// Blocked if they appear anywhere in the name (long enough not to appear inside normal names).
export const BLOCKED_ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'retard', 'tranny', 'kike', 'chink', 'wetback', 'beaner',
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pussy', 'asshole', 'bastard',
  'rapist', 'hitler', 'nazi', 'porn', 'penis', 'vagina', 'dildo',
];

// Blocked only as a whole word (short words that hide inside normal names, e.g. "Hancock", "Essex").
export const BLOCKED_WORDS = ['fag', 'spic', 'dick', 'cock', 'sex', 'ass', 'tit', 'tits', 'kkk', 'cum', 'rape'];

// Words that contain a blocked piece but are fine.
const ALLOWED = ['scunthorpe', 'therapist', 'shitake', 'shiitake', 'cockburn'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

// "F.u.c-k" -> "fuck"; "sh1t" -> "shit". Words are kept apart for the whole-word check.
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é -> e
    .replace(/[0-9@$!]/g, (c) => LEET[c] ?? c);
}

export function isNameBlocked(name) {
  const words = normalizeName(name).split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => BLOCKED_WORDS.includes(w))) return true;
  // Each word on its own (so "Shi Tao" is fine)...
  const pieces = words.filter((w) => !ALLOWED.includes(w));
  // ...plus runs of single letters joined up, so "f u c k" / "f.u.c.k" are caught.
  let run = '';
  for (const w of [...words, '']) {
    if (w.length === 1) run += w;
    else { if (run.length > 1) pieces.push(run); run = ''; }
  }
  return pieces.some((p) => BLOCKED_ANYWHERE.some((bad) => p.includes(bad)) || BLOCKED_WORDS.includes(p));
}
