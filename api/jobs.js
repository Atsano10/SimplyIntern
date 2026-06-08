module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars' });
  }

  const { keyword, location } = req.query;

  // PostgREST (Supabase's REST layer) uses `*` as the LIKE wildcard in URLs, not `%`.
  // The `or` filter lets us search across multiple columns at once.
  let url = `${SUPABASE_URL}/rest/v1/listings?select=*`;

  if (keyword) {
    const orFilter = `(title.ilike.*${keyword}*,company.ilike.*${keyword}*)`;
    url += `&or=${encodeURIComponent(orFilter)}`;
  }

  if (location) {
    url += `&location=ilike.*${encodeURIComponent(location)}*`;
  }

  // nullslast: jobs with no posted_at date go at the bottom
  url += '&order=posted_at.desc.nullslast&limit=150';

  const response = await fetch(url, {
    headers: {
      apikey:        SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept:        'application/json',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(500).json({ error: err });
  }

  const data = await response.json();

  // Cache at the Vercel edge for 5 minutes — reduces DB load on popular searches
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  return res.status(200).json(data);
};
