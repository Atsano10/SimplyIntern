// Companies that post public job boards on Greenhouse.
// If a company's board is down or offline, it fails silently (try/catch per company).
const COMPANIES = [
  'stripe', 'figma', 'notion', 'discord', 'cloudflare',
  'lyft', 'pinterest', 'mongodb', 'brex', 'plaid',
  'ramp', 'airtable', 'retool', 'gusto', 'rippling',
  'amplitude', 'hashicorp', 'confluent', 'scaleai',
  'mercury', 'webflow', 'intercom', 'benchling', 'lattice',
];

const INTERN_KEYWORDS = ['intern', 'internship', 'co-op', 'coop', 'summer'];

function isInternship(title) {
  const t = title.toLowerCase();
  return INTERN_KEYWORDS.some(kw => t.includes(kw));
}

// Greenhouse exposes a public JSON API for every company board — no auth needed.
// URL pattern: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
async function fetchGreenhouseJobs(company) {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs ?? [])
      .filter(j => isInternship(j.title))
      .map(j => ({
        title: j.title,
        company: company.charAt(0).toUpperCase() + company.slice(1),
        location: j.location?.name ?? null,
        pay: null,
        type: 'internship',
        url: j.absolute_url,
        source: 'greenhouse',
        posted_at: j.updated_at ? j.updated_at.split('T')[0] : null,
      }));
  } catch {
    return [];
  }
}

async function fetchAllGreenhouse() {
  const results = await Promise.allSettled(COMPANIES.map(fetchGreenhouseJobs));
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { fetchAllGreenhouse };
