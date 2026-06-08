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

  if (filters.location) {
    query = query.ilike('location', `%${filters.location}%`);
  }

  if (filters.industry && INDUSTRY_KEYWORDS[filters.industry]) {
    const orClauses = INDUSTRY_KEYWORDS[filters.industry]
      .map(k => `title.ilike.%${k}%`)
      .join(',');
    query = query.or(orClauses);
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
