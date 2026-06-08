const INDUSTRY_KEYWORDS = {
  tech:     ['software', 'developer', 'cybersecurity', 'technology', 'machine learning', 'programming', 'devops', 'computer science', 'data science', 'artificial intelligence', 'full stack', 'backend', 'frontend', 'systems engineer'],
  medical:  ['medical', 'healthcare', 'clinical', 'nursing', 'pharmacy', 'hospital', 'biomedical', 'pharmaceutical', 'public health'],
  finance:  ['finance', 'accounting', 'investment', 'banking', 'financial analyst', 'trading', 'wealth management', 'fintech', 'actuarial'],
  marketing:['marketing', 'advertising', 'public relations', 'communications', 'social media', 'digital marketing', 'content strategy', 'brand management'],
  legal:    ['legal', 'compliance', 'paralegal', 'regulatory', 'attorney', 'legislative', 'law clerk'],
  research: ['research', 'laboratory', 'biology', 'chemistry', 'physics', 'ecology', 'neuroscience', 'genomics', 'scientific research'],
};

async function fetchJobs(filters = {}, offset = 0, limit = 50) {
  let query = client.from('listings').select('*');

  if (filters.keyword) {
    query = query.or(
      `title.ilike.%${filters.keyword}%,company.ilike.%${filters.keyword}%`
    );
  }

  if (filters.locationPatterns && filters.locationPatterns.length > 0) {
    const orClauses = filters.locationPatterns.map(p => `location.ilike.%${p}%`).join(',');
    query = query.or(orClauses);
  }

  if (filters.industries && filters.industries.length > 0) {
    const kws = filters.industries.flatMap(ind => INDUSTRY_KEYWORDS[ind] || []);
    if (kws.length > 0) {
      query = query.or(kws.map(k => `title.ilike.%${k}%`).join(','));
    }
  }

  if (filters.jobTypes && filters.jobTypes.length > 0) {
    // Use title matching instead of the type field — the DB type field has bad data
    // from the scraper (e.g. "External Communications" was tagged as externship)
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
