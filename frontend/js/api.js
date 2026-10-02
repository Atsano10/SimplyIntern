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

// Filtering runs server-side via the `search_listings` RPC (supabase migration 006),
// so we fetch ONE page of already-filtered rows instead of pulling the whole table
// into the browser. The keyword maps above stay here as the single source of truth:
// we expand the user's selected industries/types into `%keyword%` ILIKE patterns and
// hand them to the RPC, which does the matching in SQL with trigram indexes.
//
// Matching semantics are identical to the previous client-side version:
//   keyword  -> title OR company substring   location -> ILIKE ANY(patterns)
//   industry -> title ILIKE ANY(patterns)    type     -> title ILIKE ANY(patterns)
// (Full-text / relevance ranking on the keyword box is a deliberate future upgrade;
//  this pass keeps exact parity so the scaling change doesn't shift results.)

// Returns one page of filtered results. Same (filters, offset, limit) signature the
// search UI already uses for infinite scroll.
async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  // Expand selected industry/type labels into the title ILIKE patterns the RPC expects.
  const industryPatterns = (filters.industries || [])
    .flatMap(ind => INDUSTRY_KEYWORDS[ind] || [])
    .map(kw => `%${kw}%`);
  const typePatterns = (filters.jobTypes || [])
    .flatMap(t => TYPE_PATTERNS[t] || [t])
    .map(p => `%${p}%`);

  const locationPatterns = filters.locationPatterns || [];

  const { data, error } = await client.rpc('search_listings', {
    p_keyword:            filters.keyword || null,
    p_location_patterns:  locationPatterns.length ? locationPatterns : null,
    p_industry_patterns:  industryPatterns.length ? industryPatterns : null,
    p_type_patterns:      typePatterns.length ? typePatterns : null,
    p_posted_within_days: filters.postedWithinDays ?? null,
    p_remote_only:        !!filters.remoteOnly,
    p_has_pay:            !!filters.paidOnly,
    p_sort:               filters.sort || 'newest',
    p_limit:              limit,
    p_offset:             offset,
  });

  if (error) throw error;
  return data || [];
}
