// Centralizes all backend calls so search.js never talks to Supabase or /api directly.
// Uses the Supabase client (`client` from auth.js) to query the listings table directly —
// this works because the listings table has a public-read RLS policy (no auth required).

async function fetchJobs(filters = {}) {
  let query = client.from('listings').select('*');

  if (filters.keyword) {
    // or() searches title AND company so "stripe engineer" finds both fields
    query = query.or(
      `title.ilike.%${filters.keyword}%,company.ilike.%${filters.keyword}%`
    );
  }

  if (filters.location) {
    query = query.ilike('location', `%${filters.location}%`);
  }

  const { data, error } = await query
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(150);

  if (error) throw error;
  return data ?? [];
}
