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

// The dataset is small (a few hundred listings), so instead of building fragile PostgREST
// `.or()` queries with escaped commas, I pull every listing once, cache it, and do all the
// filtering in plain JavaScript. This is far easier to reason about and debug, and it
// removes a whole class of query-encoding bugs that were silently returning zero results.
let _allListings = null;

// Fetches every listing, paging in 1000-row chunks (Supabase caps a single request at 1000).
// Results are cached for the page session and sorted newest-first once, up front.
async function loadAllListings() {
  if (_allListings) return _allListings;

  const CHUNK = 1000;
  const rows = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await client
      .from('listings')
      .select('*')
      .order('posted_at', { ascending: false, nullsFirst: false })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  _allListings = rows;
  return _allListings;
}

// Converts a SQL ILIKE pattern (where % is a wildcard) into an anchored, case-insensitive
// JS RegExp with the same semantics, so "%, NY" matches "New York, NY" but not ", Denmark".
function ilikeToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex metachars (incl. literal % handled next)
    .replace(/%/g, '.*');                   // % -> wildcard
  return new RegExp('^' + escaped + '$', 'i');
}

function matchesKeyword(job, keyword) {
  if (!keyword) return true;
  const k = keyword.toLowerCase();
  return (job.title || '').toLowerCase().includes(k)
      || (job.company || '').toLowerCase().includes(k);
}

function matchesLocation(job, patterns) {
  if (!patterns || patterns.length === 0) return true;
  const loc = job.location || '';
  return patterns.some(p => ilikeToRegExp(p).test(loc));
}

function matchesIndustry(job, industries) {
  if (!industries || industries.length === 0) return true;
  const title = (job.title || '').toLowerCase();
  const kws = industries.flatMap(ind => INDUSTRY_KEYWORDS[ind] || []);
  return kws.some(k => title.includes(k.toLowerCase()));
}

function matchesType(job, jobTypes) {
  if (!jobTypes || jobTypes.length === 0) return true;
  const title = (job.title || '').toLowerCase();
  const patterns = jobTypes.flatMap(t => TYPE_PATTERNS[t] || [t]);
  return patterns.some(p => title.includes(p.toLowerCase()));
}

// Applies every active filter (filters are AND-ed; options within one filter are OR-ed).
function applyFilters(listings, filters = {}) {
  return listings.filter(job =>
    matchesKeyword(job, filters.keyword) &&
    matchesLocation(job, filters.locationPatterns) &&
    matchesIndustry(job, filters.industries) &&
    matchesType(job, filters.jobTypes)
  );
}

// Returns one page of filtered results. Keeps the same (filters, offset, limit) signature the
// search UI already uses for infinite scroll, but everything runs client-side now.
async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  const all = await loadAllListings();
  const filtered = applyFilters(all, filters);
  return filtered.slice(offset, offset + limit);
}
