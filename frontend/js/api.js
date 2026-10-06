// I match industries by scanning the job title for these keywords
const INDUSTRY_KEYWORDS = {
  tech:     ['software', 'developer', 'cybersecurity', 'technology', 'machine learning', 'programming', 'devops', 'computer science', 'data science', 'artificial intelligence', 'full stack', 'backend', 'frontend', 'systems engineer'],
  medical:  ['medical', 'healthcare', 'clinical', 'nursing', 'pharmacy', 'hospital', 'biomedical', 'pharmaceutical', 'public health'],
  finance:  ['finance', 'accounting', 'investment', 'banking', 'financial analyst', 'trading', 'wealth management', 'fintech', 'actuarial'],
  marketing:['marketing', 'advertising', 'public relations', 'communications', 'social media', 'digital marketing', 'content strategy', 'brand management'],
  legal:    ['legal', 'compliance', 'paralegal', 'regulatory', 'attorney', 'legislative', 'law clerk'],
  research: ['research', 'laboratory', 'biology', 'chemistry', 'physics', 'ecology', 'neuroscience', 'genomics', 'scientific research'],
};

// Title keywords per job type. I match on the title instead of the DB `type` field because
// the scraper sometimes tags things wrong (e.g. "External Communications" -> externship).
const TYPE_PATTERNS = {
  'internship': ['intern'],
  'co-op':      ['co-op', 'co op', 'coop'],
  'externship': ['externship', 'extern '],
};

// Filtering runs in the database (the search_listings function, latest version in
// migration 026), so each call returns ONE page of already-filtered rows. The keyword
// maps above are the single source of truth: selected industries/types are expanded
// into `%keyword%` ILIKE patterns for the function to match against titles.
//   keyword  -> every word must match the title, company or location: as text,
//               an abbreviation (swe, nyc), a word stem, or a close spelling
//   location -> ILIKE ANY(patterns)   industry/type -> title ILIKE ANY(patterns)

// Returns one page of filtered results (used for the first page and infinite scroll).
async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  // Expand selected industry/type labels into the title ILIKE patterns the RPC expects.
  const industryPatterns = (filters.industries || [])
    .flatMap(ind => INDUSTRY_KEYWORDS[ind] || [])
    .map(kw => `%${kw}%`);
  const typePatterns = (filters.jobTypes || [])
    .flatMap(t => TYPE_PATTERNS[t] || [t])
    .map(p => `%${p}%`);

  const locationPatterns = filters.locationPatterns || [];

  const params = {
    p_keyword:            filters.keyword || null,
    p_location_patterns:  locationPatterns.length ? locationPatterns : null,
    p_industry_patterns:  industryPatterns.length ? industryPatterns : null,
    p_type_patterns:      typePatterns.length ? typePatterns : null,
    p_posted_within_days: filters.postedWithinDays ?? null,
    p_remote_only:        !!filters.remoteOnly,
    p_sort:               filters.sort || 'relevance',
    p_limit:              limit,
    p_offset:             offset,
  };
  // Only sent when used, so a database that doesn't have it yet (migration 026) still
  // answers every other search.
  if (filters.newSince) params.p_new_since = filters.newSince;

  const { data, error } = await client.rpc('search_listings', params);

  if (error) throw error;
  return data || [];
}
