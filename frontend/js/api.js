const INDUSTRY_KEYWORDS = {
  tech:     ['software', 'engineering', 'developer', 'data', 'cybersecurity', 'technology', 'machine learning', 'cloud', 'web', 'mobile', 'IT', 'programming', 'devops', 'AI'],
  medical:  ['medical', 'healthcare', 'clinical', 'nursing', 'pharmacy', 'hospital', 'biomedical', 'pharmaceutical', 'health'],
  finance:  ['finance', 'accounting', 'investment', 'banking', 'financial', 'analyst', 'trading', 'wealth', 'fintech'],
  marketing:['marketing', 'advertising', 'brand', 'social media', 'communications', 'PR', 'public relations', 'digital marketing', 'content'],
  legal:    ['legal', 'law', 'compliance', 'paralegal', 'regulatory', 'attorney', 'policy'],
  research: ['research', 'science', 'laboratory', 'biology', 'chemistry', 'physics', 'ecology', 'neuroscience', 'genomics'],
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
    query = query.in('type', filters.jobTypes);
  }

  const { data, error } = await query
    .order('posted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data ?? [];
}
