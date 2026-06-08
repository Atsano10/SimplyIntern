// Centralizes all backend calls so search.js never talks to Supabase or /api directly.
// Uses the Supabase client (`client` from auth.js) to query the listings table directly —
// this works because the listings table has a public-read RLS policy (no auth required).

async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  let query = client.from('listings').select('*');

  if (filters.keyword) {
    query = query.or(
      `title.ilike.%${filters.keyword}%,company.ilike.%${filters.keyword}%`
    );
  }

  if (filters.location) {
    query = query.ilike('location', `%${filters.location}%`);
  }

  if (filters.jobType) {
    query = query.eq('type', filters.jobType);
  }

  const { data, error } = await query
    .order('posted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data ?? [];
}
