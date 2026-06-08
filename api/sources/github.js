const REPOS = [
  { owner: 'pittcsc',      repo: 'Summer2026-Internships' },
  { owner: 'SimplifyJobs', repo: 'Summer2026-Internships' },
];

const INTERN_KEYWORDS = ['intern', 'internship', 'co-op', 'coop', 'summer'];

function isInternship(title) {
  const t = title.toLowerCase();
  return INTERN_KEYWORDS.some(kw => t.includes(kw));
}

// Parses a GitHub README markdown table into job objects.
// Handles both markdown links [text](url) and HTML anchors <a href="url">.
function parseMarkdownTable(content) {
  const lines = content.split('\n');
  const jobs = [];
  let rowsInTable = 0;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) { rowsInTable = 0; continue; }
    rowsInTable++;
    if (rowsInTable <= 2) continue; // skip header row + separator row (| --- |)

    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 4) continue;

    const [companyRaw, roleRaw, locationRaw, linkCol] = cols;

    const mdLink   = linkCol.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
    const htmlLink = linkCol.match(/href="(https?:\/\/[^"]+)"/);
    const url = mdLink?.[1] ?? htmlLink?.[1];
    if (!url) continue;

    const role     = roleRaw.replace(/[*_`[\]🔒✅❌]/g, '').trim();
    const company  = companyRaw.replace(/[*_`[\]]/g, '').trim();
    const location = locationRaw.replace(/[*_`[\]]/g, '').trim();

    if (!role || !company || !isInternship(role)) continue;

    jobs.push({
      title: role,
      company,
      location: location || null,
      pay: null,
      type: 'internship',
      url,
      source: 'github',
      posted_at: null,
    });
  }
  return jobs;
}

async function fetchGithubRepo(owner, repo, token) {
  try {
    const headers = { 'User-Agent': 'SimplyIntern/1.0' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    return parseMarkdownTable(await res.text());
  } catch {
    return [];
  }
}

async function fetchAllGithub(token) {
  const results = await Promise.allSettled(
    REPOS.map(({ owner, repo }) => fetchGithubRepo(owner, repo, token))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { fetchAllGithub };
