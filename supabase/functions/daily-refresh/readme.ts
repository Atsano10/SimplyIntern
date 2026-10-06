// Parsers for the community internship lists' README files (GitHub). Each list formats
// its table differently, so parseGithubReadme picks the right parser per repo.
import { cleanCellText, cleanZapplyLocation, getType, isInternship, type Listing, mapPipeColumns,
  parseGithubAge, programPay, stripTrackingParams } from './helpers.ts';
import { normalizeGreenhouseLocation, normalizeLocation } from './locations.ts';

export interface GithubRepo {
  owner: string;
  repo: string;
  kind?: 'jobs' | 'programs';
  messyLocations?: boolean;   // run locations through the Greenhouse cleaner
}

// Parses the HTML <table> format that SimplifyJobs switched to.
// Rows with "↳" in the company column are sub-roles — I carry the last company name forward.
export function parseHtmlTable(content: string): Listing[] {
  const jobs: Listing[] = [];
  let lastCompany = '';

  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowM: RegExpExecArray | null;

  while ((rowM = rowRe.exec(content)) !== null) {
    const rowHtml = rowM[1];
    const tdRe = /<td>([\s\S]*?)<\/td>/gi;
    const cols: string[] = [];
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(rowHtml)) !== null) cols.push(tdM[1].trim());
    if (cols.length < 4) continue;

    const [companyCol, roleCol, locationCol, linkCol] = cols;
    const dateCol = cols[4]; // SimplifyJobs: Company | Role | Location | Link | Date Posted

    const rawCompanyText = cleanCellText(companyCol.replace(/<[^>]+>/g, ''));
    let company: string;
    if (rawCompanyText === '↳') {
      if (!lastCompany) continue;
      company = lastCompany;
    } else {
      const aM = companyCol.match(/<a[^>]*>([^<]+)<\/a>/);
      company = cleanCellText(aM ? aM[1] : rawCompanyText);
      if (!company) continue;
      lastCompany = company;
    }

    const role     = cleanCellText(roleCol.replace(/<[^>]+>/g, ''));
    const location = normalizeLocation(locationCol);
    const urlM     = linkCol.match(/href="(https?:\/\/[^"]+)"/);
    const url      = urlM?.[1];
    if (!url || !role || !isInternship(role)) continue;

    jobs.push({
      title: role, company, location, pay: null,
      type: getType(role), url, source: 'github',
      posted_at: parseGithubAge(dateCol),
    });
  }
  return jobs;
}

// "| a | b |" -> ["a", "b"], keeping empty cells so columns don't shift (zapply's
// Visa column is often blank). A missing closing pipe doesn't drop the last cell.
function splitRow(line: string): string[] {
  const parts = line.trim().split('|').slice(1);
  if (line.trim().endsWith('|')) parts.pop();
  return parts.map(c => c.trim());
}

// Parses markdown pipe tables. Columns are found from each table's header row
// (mapPipeColumns), since lists order them differently; tables that aren't job tables
// are skipped.
export function parsePipeTable(content: string, messyLocations = false): Listing[] {
  const jobs: Listing[] = [];
  let cols: ReturnType<typeof mapPipeColumns> = null;
  let rowsInTable = 0;
  let lastCompany = '';

  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) { rowsInTable = 0; cols = null; continue; }
    rowsInTable++;
    const cells = splitRow(line);
    if (rowsInTable === 1) { cols = mapPipeColumns(cells); continue; }   // header row
    if (rowsInTable === 2 || !cols) continue;                            // separator / not a job table

    const linkCol  = cells[cols.link] ?? '';
    const mdLink   = linkCol.match(/\[.*?\]\((https?:\/\/[^)\s]+)\)/);
    const htmlLink = linkCol.match(/href="(https?:\/\/[^"]+)"/);
    const url = mdLink?.[1] ?? htmlLink?.[1];
    if (!url) continue;

    const role = cleanCellText((cells[cols.role] ?? '').replace(/[*_`[\]]/g, ''));
    const companyClean = cleanCellText((cells[cols.company] ?? '').replace(/[*_`[\]]/g, ''));
    let company: string;
    if (companyClean === '↳') {
      if (!lastCompany) continue;
      company = lastCompany;
    } else {
      company = companyClean;
      if (company) lastCompany = company;
    }

    const locationRaw = cols.location >= 0 ? (cells[cols.location] ?? '').replace(/[*_`[\]]/g, '').trim() : '';
    const location = messyLocations
      ? normalizeGreenhouseLocation(cleanZapplyLocation(locationRaw))
      : normalizeLocation(locationRaw);
    if (!role || !company || !isInternship(role)) continue;

    jobs.push({
      title: role, company, location, pay: null,
      type: getType(role), url, source: 'github',
      posted_at: parseGithubAge(cols.date >= 0 ? cells[cols.date] : undefined),
    });
  }
  return jobs;
}

// deepanshu1422's list of open-source programs, contests, and bootcamps. Every table
// starts with a "Name" column ([Program](link)) followed by a money column (Stipend /
// Rewards / Cost), which becomes the pay label shown on Search ("Unpaid", "Paid
// stipend", "Tuition: ..."). The section heading becomes the "company" line. These are
// standing programs, not dated postings, so there's no posted date and type is 'program'.
export function parseProgramTables(content: string): Listing[] {
  const programs: Listing[] = [];
  let section = '';
  let moneyCol = '';
  let rowsInTable = 0;

  for (const line of content.split('\n')) {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) { section = cleanCellText(heading[1]).replace(/^[^A-Za-z0-9]+/, ''); continue; }
    if (!line.trim().startsWith('|')) { rowsInTable = 0; moneyCol = ''; continue; }
    rowsInTable++;
    const cells = splitRow(line);
    if (rowsInTable === 1) {
      moneyCol = cells[0]?.toLowerCase() === 'name' ? (cells[1] ?? '') : '';
      continue;
    }
    if (rowsInTable === 2 || !moneyCol) continue;

    const link = cells[0]?.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (!link) continue;
    programs.push({
      title:      cleanCellText(link[1]),
      company:    section || 'Open Source Program',
      location:   'Remote',
      pay:        programPay(moneyCol, cells[1] ?? ''),
      type:       'program',
      url:        stripTrackingParams(link[2]),   // e.g. drops "?ref=30daysofcoding"
      source:     'github',
      posted_at:  null,
    });
  }
  return programs;
}

// Auto-detects which format the README uses and calls the right parser
export function parseGithubReadme(content: string, repo: GithubRepo): Listing[] {
  if (repo.kind === 'programs') return parseProgramTables(content);
  return /<table[\s>]/i.test(content)
    ? parseHtmlTable(content)
    : parsePipeTable(content, repo.messyLocations);
}
