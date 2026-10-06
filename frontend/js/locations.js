// Location filter model, loaded on the search page before search.js.
//
// listings.location is free text from many sources ("Nyc", "Toronto, CAN",
// "Hong Kong SAR", "Denver, CO - Hybrid", "6 locationsSeattle, WA / Sf", ...), and
// multi-location listings join their places with " / ". Showing every distinct
// string as a filter option produced hundreds of near-duplicates, so instead each
// place is sorted into ONE clean bucket — Remote, a US state, or a country — and
// every US state also rolls up into "United States".
//
// For each bucket we also build the ILIKE patterns that select exactly the listings
// in it (handed to the search_listings RPC). Patterns are anchored to whole " / "
// parts, so "India" can't match "Indianapolis, IN" and ", DE" can't match "Denmark".

const LOC_US_STATES = {
  AL: 'Alabama',       AK: 'Alaska',        AZ: 'Arizona',        AR: 'Arkansas',
  CA: 'California',    CO: 'Colorado',      CT: 'Connecticut',    DE: 'Delaware',
  FL: 'Florida',       GA: 'Georgia',       HI: 'Hawaii',         ID: 'Idaho',
  IL: 'Illinois',      IN: 'Indiana',       IA: 'Iowa',           KS: 'Kansas',
  KY: 'Kentucky',      LA: 'Louisiana',     ME: 'Maine',          MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan',      MN: 'Minnesota',      MS: 'Mississippi',
  MO: 'Missouri',      MT: 'Montana',       NE: 'Nebraska',       NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey',    NM: 'New Mexico',     NY: 'New York',
  NC: 'North Carolina',ND: 'North Dakota',  OH: 'Ohio',           OK: 'Oklahoma',
  OR: 'Oregon',        PA: 'Pennsylvania',  RI: 'Rhode Island',   SC: 'South Carolina',
  SD: 'South Dakota',  TN: 'Tennessee',     TX: 'Texas',          UT: 'Utah',
  VT: 'Vermont',       VA: 'Virginia',      WA: 'Washington',     WV: 'West Virginia',
  WI: 'Wisconsin',     WY: 'Wyoming',       DC: 'Washington DC',
};

// Full state names -> code ("Georgia" is treated as the US state).
const LOC_STATE_BY_NAME = Object.fromEntries(
  Object.entries(LOC_US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
LOC_STATE_BY_NAME['washington, dc'] = 'DC';
LOC_STATE_BY_NAME['district of columbia'] = 'DC';

const LOC_US_COUNTRY = new Set([
  'united states', 'united states of america', 'usa', 'us', 'u.s.', 'u.s.a.',
]);

// City names and nicknames that show up without a state.
const LOC_US_CITIES = {
  'nyc': 'NY', 'new york': 'NY', 'new york city': 'NY', 'long island': 'NY',
  'sf': 'CA', 'south sf': 'CA', 'san francisco': 'CA', 'south san francisco': 'CA',
  'bay area': 'CA', 'la': 'CA', 'los angeles': 'CA', 'san jose': 'CA', 'san diego': 'CA',
  'palo alto': 'CA', 'mountain view': 'CA', 'menlo park': 'CA', 'sunnyvale': 'CA',
  'seattle': 'WA', 'bellevue': 'WA', 'redmond': 'WA',
  'boston': 'MA', 'cambridge': 'MA', 'pittsburgh': 'PA', 'philadelphia': 'PA',
  'austin': 'TX', 'dallas': 'TX', 'houston': 'TX', 'chicago': 'IL', 'denver': 'CO',
  'atlanta': 'GA', 'miami': 'FL', 'washington dc': 'DC', 'dc': 'DC',
};

// Country names, codes and alternate spellings -> one canonical country.
const LOC_COUNTRIES = {};
[
  'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'China',
  'Colombia', 'Czech Republic', 'Denmark', 'Egypt', 'Finland', 'France', 'Germany',
  'Greece', 'Hong Kong', 'Hungary', 'India', 'Indonesia', 'Ireland', 'Israel', 'Italy',
  'Japan', 'Kenya', 'Malaysia', 'Mexico', 'Netherlands', 'New Zealand', 'Nigeria',
  'Norway', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Saudi Arabia', 'Serbia', 'Singapore', 'South Africa', 'South Korea', 'Spain',
  'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'UAE', 'Ukraine',
  'United Kingdom', 'Vietnam',
].forEach(c => { LOC_COUNTRIES[c.toLowerCase()] = c; });
Object.assign(LOC_COUNTRIES, {
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'england': 'United Kingdom',
  'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'great britain': 'United Kingdom',
  'gb': 'United Kingdom', 'gbr': 'United Kingdom',
  'can': 'Canada', 'on': 'Canada', 'bc': 'Canada', 'qc': 'Canada', 'ab': 'Canada',
  'nz': 'New Zealand', 'nzl': 'New Zealand', 'ch': 'Switzerland', 'che': 'Switzerland',
  'ie': 'Ireland', 'irl': 'Ireland', 'deu': 'Germany', 'fra': 'France', 'esp': 'Spain',
  'ita': 'Italy', 'nld': 'Netherlands', 'the netherlands': 'Netherlands', 'ind': 'India',
  'jpn': 'Japan', 'kor': 'South Korea', 'korea': 'South Korea', 'sgp': 'Singapore',
  'aus': 'Australia', 'bra': 'Brazil', 'mex': 'Mexico', 'chn': 'China', 'twn': 'Taiwan',
  'hong kong sar': 'Hong Kong', 'hkg': 'Hong Kong',
  'united arab emirates': 'UAE', 'are': 'UAE',
  'mg': 'Brazil', 'sp': 'Brazil', 'rj': 'Brazil',   // Brazilian state codes
});

// Cities that appear without a country.
const LOC_INTL_CITIES = {
  'london': 'United Kingdom', 'manchester': 'United Kingdom', 'paris': 'France',
  'berlin': 'Germany', 'munich': 'Germany', 'amsterdam': 'Netherlands',
  'madrid': 'Spain', 'barcelona': 'Spain', 'zurich': 'Switzerland', 'dublin': 'Ireland',
  'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada', 'waterloo': 'Canada',
  'tokyo': 'Japan', 'seoul': 'South Korea', 'taipei': 'Taiwan',
  'bengaluru': 'India', 'bangalore': 'India', 'hyderabad': 'India', 'mumbai': 'India',
  'bucharest': 'Romania', 'sydney': 'Australia', 'melbourne': 'Australia',
  'tel aviv': 'Israel', 'dubai': 'UAE', 'abu dhabi': 'UAE',
};

// Resolves one comma segment to { key, kind }, or null if it isn't a known place.
// kind is 'region' (state code / state / country) or 'city'.
function locResolveSegment(seg, preferCity) {
  const s = seg.trim();
  const lower = s.toLowerCase();
  const city = LOC_US_CITIES[lower] ? { key: 'us:' + LOC_US_CITIES[lower], kind: 'city' }
             : LOC_INTL_CITIES[lower] ? { key: 'intl:' + LOC_INTL_CITIES[lower], kind: 'city' }
             : null;
  // A lone "LA"/"SF"/"DC" is a city nickname; "Baton Rouge, LA" ends in a state code.
  if (preferCity && city) return city;
  if (/^[A-Z]{2}$/.test(s) && LOC_US_STATES[s]) return { key: 'us:' + s, kind: 'region' };
  if (LOC_US_COUNTRY.has(lower)) return { key: 'us', kind: 'region' };
  if (LOC_STATE_BY_NAME[lower]) return { key: 'us:' + LOC_STATE_BY_NAME[lower], kind: 'region' };
  if (LOC_COUNTRIES[lower]) return { key: 'intl:' + LOC_COUNTRIES[lower], kind: 'region' };
  return city;
}

// Classifies one " / " part of a location string into bucket keys:
// 'remote', 'us' (US, state unknown), 'us:CA', 'intl:Canada'. Returns [] if unknown.
function locClassifyPart(raw) {
  const p = raw
    .replace(/^\d+\s*locations?\s*/i, '')        // scraper artefact: "4 locationsSF"
    .replace(/\s*[-–(]\s*hybrid\)?\s*$/i, '')     // "Denver, CO - Hybrid"
    .replace(/,\s*hybrid\s*$/i, '')               // "Amsterdam, Hybrid"
    .trim();
  if (!p) return [];
  if (/\bremote\b/i.test(p)) return ['remote'];

  const segs = p.split(',')
    .map(s => s.trim().replace(/^or\s+/i, '').replace(/\s+hq$/i, ''))
    .filter(Boolean);
  if (segs.length === 0) return [];

  if (segs.length === 1) {
    const r = locResolveSegment(segs[0], true);
    return r ? [r.key] : [];
  }

  const last = locResolveSegment(segs[segs.length - 1], false);
  if (!last) return [];

  // "City, City" lists ("New York, Seattle", "London, Tokyo") -> every city named.
  if (last.kind === 'city') {
    const keys = segs.map(s => locResolveSegment(s, true)).filter(Boolean).map(r => r.key);
    return [...new Set(keys)];
  }

  // "Boston, USA" / "Bay Area, United States of America" -> refine to the state.
  if (last.key === 'us') {
    const first = locResolveSegment(segs[0], true);
    if (first && first.key.startsWith('us:')) return [first.key];
  }
  return [last.key];
}

// Escapes LIKE wildcards so a literal location string can be used in a pattern.
function locEscapeLike(s) {
  return s.replace(/[\\%_]/g, '\\$&');
}

// Patterns matching a listing whose location contains `part` as a whole " / " part.
function locExactPatterns(part) {
  const e = locEscapeLike(part);
  return [e, `${e} / %`, `% / ${e}`, `% / ${e} / %`];
}

// Builds the filter options from each distinct location string and how many
// listings have it, e.g. { "Seattle, WA": 12 } (the listing_locations RPC).
// Returns { options: [{ value, label, group, count }], patterns: { value: [...] }, unknown: [...] }
// Groups: 'top' (Remote, United States), 'us' (states), 'intl' (countries).
function buildLocationIndex(locationCounts) {
  const counts = {};
  const patterns = {};   // bucket -> Set of ILIKE patterns
  const unknown = new Set();
  const addPatterns = (key, list) => {
    if (!patterns[key]) patterns[key] = new Set();
    list.forEach(p => patterns[key].add(p));
  };

  Object.entries(locationCounts).forEach(([loc, n]) => {
    if (!loc) return;
    const keys = new Set();
    loc.split(' / ').forEach(rawPart => {
      const part = rawPart.trim();
      if (!part) return;
      const partKeys = locClassifyPart(part);
      if (partKeys.length === 0) unknown.add(part);

      partKeys.forEach(key => {
        keys.add(key);
        if (key.startsWith('us:')) keys.add('us');

        let list;
        if (key === 'remote') {
          list = ['%remote%'];
        } else if (key.startsWith('us:') && part.endsWith(', ' + key.slice(3))) {
          // "City, ST" — two suffix patterns cover every city in the state.
          const code = key.slice(3);
          list = [`%, ${code}`, `%, ${code} / %`];
        } else {
          list = locExactPatterns(part);
        }
        addPatterns(key, list);
        if (key.startsWith('us:')) addPatterns('us', list);
      });
    });
    keys.forEach(k => { counts[k] = (counts[k] || 0) + n; });
  });

  const options = Object.keys(counts).map(value => {
    if (value === 'remote') return { value, label: 'Remote', group: 'top', count: counts[value] };
    if (value === 'us')     return { value, label: 'United States (all)', group: 'top', count: counts[value] };
    if (value.startsWith('us:'))
      return { value, label: LOC_US_STATES[value.slice(3)], group: 'us', count: counts[value] };
    return { value, label: value.slice(5), group: 'intl', count: counts[value] };
  });
  // Remote, then United States, then everything else alphabetically.
  const rank = o => (o.value === 'remote' ? 0 : o.value === 'us' ? 1 : 2);
  options.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));

  const patternLists = {};
  Object.keys(patterns).forEach(k => { patternLists[k] = [...patterns[k]]; });
  return { options, patterns: patternLists, unknown: [...unknown] };
}
