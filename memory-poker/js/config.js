// Supabase project for live rooms.
// Both values are safe to publish: the publishable (anon) key only reaches what the
// Row Level Security rules in supabase/schema.sql allow. NEVER put the secret
// (service_role) key here.
//
// Leave them empty to run live rooms in "local test mode": rooms then live only in this
// browser (open several tabs to play against yourself). Add ?backend=local to any room
// link to force local mode even when these are set.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
