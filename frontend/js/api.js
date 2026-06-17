// I match industries by scanning the job title for these keywords
const INDUSTRY_KEYWORDS = {
  tech:     ['software', 'developer', 'cybersecurity', 'technology', 'machine learning', 'programming', 'devops', 'computer science', 'data science', 'artificial intelligence', 'full stack', 'backend', 'frontend', 'systems engineer'],
  medical:  ['medical', 'healthcare', 'clinical', 'nursing', 'pharmacy', 'hospital', 'biomedical', 'pharmaceutical', 'public health'],
  finance:  ['finance', 'accounting', 'investment', 'banking', 'financial analyst', 'trading', 'wealth management', 'fintech', 'actuarial'],
  marketing:['marketing', 'advertising', 'public relations', 'communications', 'social media', 'digital marketing', 'content strategy', 'brand management'],
  legal:    ['legal', 'compliance', 'paralegal', 'regulatory', 'attorney', 'legislative', 'law clerk'],
  research: ['research', 'laboratory', 'biology', 'chemistry', 'physics', 'ecology', 'neuroscience', 'genomics', 'scientific research'],
};

// Builds and runs the Supabase query based on whatever filters are currently active.
// Returns one page of results — offset and limit control pagination.
async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  let query = client.from('listings').select('*');

  if (filters.keyword) {
    query = query.or(
      `title.ilike.%${filters.keyword}%,company.ilike.%${filters.keyword}%`
    );
  }

  if (filters.locationPatterns && filters.locationPatterns.length > 0) {
    // Each pattern is already a complete ilike value with wildcards in place
    // (e.g. "%, NY", "%, NY /%", "%remote%"). Patterns are anchored to a part
    // boundary upstream so a state code can't bleed into a country name.
    // Values containing a comma must be wrapped in double-quotes per the PostgREST
    // spec, otherwise the comma is misread as an OR-condition separator and the
    // whole query silently returns nothing (this is why "New York" showed no results).
    const orClauses = filters.locationPatterns
      .map(p => p.includes(',') ? `location.ilike."${p}"` : `location.ilike.${p}`)
      .join(',');
    query = query.or(orClauses);
  }

  if (filters.industries && filters.industries.length > 0) {
    const kws = filters.industries.flatMap(ind => INDUSTRY_KEYWORDS[ind] || []);
    if (kws.length > 0) {
      query = query.or(kws.map(k => `title.ilike.%${k}%`).join(','));
    }
  }

  if (filters.jobTypes && filters.jobTypes.length > 0) {
    // I match by title instead of the DB type field because the scraper sometimes tags things wrong
    // (e.g. a role called "External Communications" was getting tagged as an externship)
    const TYPE_PATTERNS = {
      'internship': ['intern'],
      'co-op':      ['co-op', 'co op', 'coop'],
      'externship': ['externship', 'extern '],
    };
    const patterns = filters.jobTypes.flatMap(t => TYPE_PATTERNS[t] || [t]);
    query = query.or(patterns.map(p => `title.ilike.%${p}%`).join(','));
  }

  const { data, error } = await query
    .order('posted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data ?? [];
}
