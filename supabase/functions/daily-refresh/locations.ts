// Location cleanup for daily-refresh. Every source sends location strings in its own
// format, so everything is normalized into "City, ST" for the US or "City, Country"
// elsewhere before it's saved. This is what makes the location filter work.
//   normalizeLocation            GitHub README cells ("us->california", "<br>"-separated)
//   normalizeGreenhouseLocation  free-text job-board locations (Greenhouse, Lever, Ashby)
//   jobLocation                  a posting's list of locations, plus "Remote"

// Used to convert full state names like "California" into codes like "CA"
const STATE_CODES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY',
};

// Capitalizes the first letter of each word
function titleCase(s: string): string {
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
}

// Handles a single location chunk from a GitHub README.
// GitHub repos use "us->state" or "country->city" format which I convert to clean strings.
function normalizeOnePart(part: string): string {
  const p = part.trim();
  if (!p) return '';
  if (/\bremote\b/i.test(p)) return 'Remote';

  if (/^us->/i.test(p)) {
    const rest = p.slice(4).replace(/_/g, ' ').trim();
    if (/\bremote\b/i.test(rest)) return 'Remote';
    if (/^washington[\s,]+dc$/i.test(rest) || /^district of columbia$/i.test(rest)) return 'Washington, DC';
    const withCode = rest.match(/^(.+),\s*([A-Za-z]{2})$/);
    if (withCode) return `${titleCase(withCode[1])}, ${withCode[2].toUpperCase()}`;
    const code = STATE_CODES[rest.toLowerCase()];
    if (code) return `${titleCase(rest)}, ${code}`;
    return titleCase(rest);
  }

  // Other country->city format (e.g. canada->toronto, uk->london) — I just extract the country
  const arrowMatch = p.match(/^([a-z][a-z_\s]*)->.*/i);
  if (arrowMatch) return titleCase(arrowMatch[1].replace(/_/g, ' ').trim());

  // A plain word or name (e.g. "india", "united_kingdom", "NYC", "Seattle"). Cities and
  // abbreviations the Greenhouse cleaner knows get its full form ("NYC" -> "New York, NY"),
  // so they group with the same city from other sources; anything else is title-cased.
  if (/^[a-z][a-z_\s]*$/i.test(p) && !p.includes(',')) {
    const name = p.replace(/_/g, ' ');
    return KNOWN_US_CITIES[name.toLowerCase()] || KNOWN_INTL_CITIES[name.toLowerCase()] || titleCase(name);
  }

  // Already clean (e.g. "San Francisco, CA" or "London, England")
  return p;
}

// Entry point for GitHub locations.
// Some repos use multi-location HTML cells like <details><summary>3 locations</summary>...<br>...</details>
// I strip the tags, split on <br>, normalize each part, and join them with " / ".
export function normalizeLocation(raw: string): string | null {
  if (!raw) return null;
  const detagged = raw
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')   // drop the "N locations" label
    .replace(/<br\s*\/?>/gi, '|')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!detagged) return null;
  const parts = detagged.split('|').map(p => p.trim()).filter(Boolean);
  const normalized = [...new Set(parts.map(normalizeOnePart).filter(Boolean))];
  if (normalized.length === 0) return null;
  return normalized.join(' / ');
}

// Quick lookup to check if a 2-letter code is a real US state
const US_STATE_CODE_SET = new Set([...Object.values(STATE_CODES), 'DC']);

// Some Greenhouse boards prefix locations with a 2-letter country code like "ES-Barcelona" or "NL-Hub".
// I use this to map those prefixes to readable country names.
const COUNTRY_CODE_PREFIXES: Record<string, string> = {
  NL: 'Netherlands', ES: 'Spain', DE: 'Germany', FR: 'France',
  GB: 'United Kingdom', IT: 'Italy', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', BE: 'Belgium', CH: 'Switzerland',
  AT: 'Austria', PT: 'Portugal', PL: 'Poland', CZ: 'Czech Republic',
  TR: 'Turkey', AE: 'UAE', SG: 'Singapore', JP: 'Japan', CN: 'China',
  AU: 'Australia', NZ: 'New Zealand', BR: 'Brazil', MX: 'Mexico',
  AR: 'Argentina', CO: 'Colombia', CL: 'Chile', ZA: 'South Africa',
};

// Greenhouse sometimes sends just a city name without a state.
// I use this map to fill in the state so it groups correctly in the filter.
const KNOWN_US_CITIES: Record<string, string> = {
  'sf': 'San Francisco, CA',         'san francisco': 'San Francisco, CA',
  'nyc': 'New York, NY',             'new york': 'New York, NY',
  'new york city': 'New York, NY',   'los angeles': 'Los Angeles, CA',
  'la': 'Los Angeles, CA',           'south sf': 'South San Francisco, CA',
  'south san francisco': 'South San Francisco, CA',
  'chicago': 'Chicago, IL',          'boston': 'Boston, MA',
  'austin': 'Austin, TX',            'denver': 'Denver, CO',
  'atlanta': 'Atlanta, GA',          'miami': 'Miami, FL',
  'dallas': 'Dallas, TX',            'houston': 'Houston, TX',
  'dc': 'Washington, DC',            'washington dc': 'Washington, DC',
  'phoenix': 'Phoenix, AZ',          'portland': 'Portland, OR',
  'san diego': 'San Diego, CA',      'san jose': 'San Jose, CA',
  'palo alto': 'Palo Alto, CA',      'mountain view': 'Mountain View, CA',
  'sunnyvale': 'Sunnyvale, CA',      'menlo park': 'Menlo Park, CA',
  'redwood city': 'Redwood City, CA','bellevue': 'Bellevue, WA',
  'cambridge': 'Cambridge, MA',      'seattle': 'Seattle, WA',
  'minneapolis': 'Minneapolis, MN',  'philadelphia': 'Philadelphia, PA',
  'pittsburgh': 'Pittsburgh, PA',    'raleigh': 'Raleigh, NC',
  'charlotte': 'Charlotte, NC',      'nashville': 'Nashville, TN',
  'salt lake city': 'Salt Lake City, UT', 'las vegas': 'Las Vegas, NV',
};

// Same idea for international cities — "Paris" alone becomes "Paris, France"
// so it groups under France in the filter instead of appearing as its own entry
const KNOWN_INTL_CITIES: Record<string, string> = {
  'paris': 'Paris, France',             'london': 'London, England',
  'berlin': 'Berlin, Germany',          'amsterdam': 'Amsterdam, Netherlands',
  'madrid': 'Madrid, Spain',            'barcelona': 'Barcelona, Spain',
  'rome': 'Rome, Italy',                'milan': 'Milan, Italy',
  'zurich': 'Zurich, Switzerland',      'stockholm': 'Stockholm, Sweden',
  'oslo': 'Oslo, Norway',               'copenhagen': 'Copenhagen, Denmark',
  'helsinki': 'Helsinki, Finland',      'brussels': 'Brussels, Belgium',
  'vienna': 'Vienna, Austria',          'prague': 'Prague, Czech Republic',
  'warsaw': 'Warsaw, Poland',           'lisbon': 'Lisbon, Portugal',
  'toronto': 'Toronto, Canada',         'vancouver': 'Vancouver, Canada',
  'montreal': 'Montreal, Canada',       'ottawa': 'Ottawa, Canada',
  'sydney': 'Sydney, Australia',        'melbourne': 'Melbourne, Australia',
  'tokyo': 'Tokyo, Japan',              'osaka': 'Osaka, Japan',
  'singapore': 'Singapore',             'hong kong': 'Hong Kong',
  'dubai': 'Dubai, UAE',                'tel aviv': 'Tel Aviv, Israel',
  'bangalore': 'Bangalore, India',      'mumbai': 'Mumbai, India',
  'delhi': 'Delhi, India',              'hyderabad': 'Hyderabad, India',
  'beijing': 'Beijing, China',          'shanghai': 'Shanghai, China',
  'seoul': 'Seoul, South Korea',        'taipei': 'Taipei, Taiwan',
  'mexico city': 'Mexico City, Mexico', 'bogota': 'Bogotá, Colombia',
  'buenos aires': 'Buenos Aires, Argentina', 'sao paulo': 'São Paulo, Brazil',
  'cape town': 'Cape Town, South Africa', 'nairobi': 'Nairobi, Kenya',
};

// 3-letter ISO country codes some boards use instead of a name
const ISO3: Record<string, string> = {
  USA: 'United States', CAN: 'Canada',  GBR: 'United Kingdom', DEU: 'Germany',
  FRA: 'France',        AUS: 'Australia', IND: 'India',         CHN: 'China',
  JPN: 'Japan',         KOR: 'South Korea', SGP: 'Singapore',   NLD: 'Netherlands',
  ESP: 'Spain',         ITA: 'Italy',    BRA: 'Brazil',         MEX: 'Mexico',
  ARG: 'Argentina',     COL: 'Colombia', CHL: 'Chile',          ZAF: 'South Africa',
  NZL: 'New Zealand',   SWE: 'Sweden',   NOR: 'Norway',         DNK: 'Denmark',
  FIN: 'Finland',       BEL: 'Belgium',  CHE: 'Switzerland',    AUT: 'Austria',
  PRT: 'Portugal',      POL: 'Poland',   CZE: 'Czech Republic', TUR: 'Turkey',
  ISR: 'Israel',        ARE: 'UAE',      TWN: 'Taiwan',         HKG: 'Hong Kong',
  THA: 'Thailand',      IDN: 'Indonesia', MYS: 'Malaysia',      PHL: 'Philippines',
  VNM: 'Vietnam',       UKR: 'Ukraine',  EGY: 'Egypt',          NGA: 'Nigeria',
  KEN: 'Kenya',         GHA: 'Ghana',    IRE: 'Ireland',        IRL: 'Ireland',
};

// Greenhouse location strings are all over the place — companies enter whatever they want.
// This function handles every weird format I've seen and turns it into a clean
// "City, ST" (US) or "City, Country" (international) string.
export function normalizeGreenhouseLocation(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // "In-Office" isn't a real location, so I drop it
  if (/^in[-\s]?office$/i.test(s)) return null;

  // Various ways companies write "United States"
  if (/^(usa|u\.s\.a\.|united states of america)$/i.test(s)) return 'United States';

  // 3-letter ISO country codes like "CAN", "GBR", "DEU"
  if (/^[A-Z]{3}$/.test(s) && ISO3[s]) return ISO3[s];

  if (/^remote$/i.test(s)) return 'Remote';
  // Regional "remote" labels like "APAC - Remote" or "EMEA - Remote"
  if (/^(apac|emea|americas|latam|global)\s*[-–]\s*remote$/i.test(s)) return 'Remote';

  // Some companies list multiple locations separated by semicolons — I normalize each one
  if (s.includes(';')) {
    const parts = s.split(';')
      .map(p => normalizeGreenhouseLocation(p.trim()))
      .filter((p): p is string => p !== null && p !== '');
    const unique = [...new Set(parts)];
    return unique.length > 0 ? unique.join(' / ') : null;
  }

  // Anything that contains "remote" anywhere (e.g. "Colombia, Remote") → just Remote
  if (/\bremote\b/i.test(s)) return 'Remote';

  // "US > State > City" format  e.g. "US > Arizona > Phoenix"
  const usArrow = s.match(/^us\s*>\s*([^>]+?)\s*>\s*([^>]+)$/i);
  if (usArrow) {
    const code = STATE_CODES[usArrow[1].trim().toLowerCase()];
    const city = titleCase(usArrow[2].replace(/\(.*?\)/g, '').trim());
    return code ? `${city}, ${code}` : `${city}, US`;
  }

  // "Country > City" or any other arrow format — I just extract the country
  if (s.includes('>')) {
    return titleCase(s.split('>')[0].replace(/[()]/g, '').trim()) || null;
  }

  // "XX-CityOrLabel" — either a US state prefix or a country code prefix
  // e.g. "ES-Barcelona" → Spain, "NL-Hub" → Netherlands, "CA-Toronto" → Toronto, CA (California)
  const prefixM = s.match(/^([A-Z]{2})-(.+)$/);
  if (prefixM) {
    const code = prefixM[1];
    if (US_STATE_CODE_SET.has(code)) return `${titleCase(prefixM[2].replace(/-/g, ' ').trim())}, ${code}`;
    if (COUNTRY_CODE_PREFIXES[code]) return COUNTRY_CODE_PREFIXES[code];
  }

  // "City, ST United States" with a missing comma before the country
  // e.g. "San Mateo, CA United States" → "San Mateo, CA"
  const missingComma = s.match(/^(.+,\s*[A-Z]{2})\s+United States$/i);
  if (missingComma) return missingComma[1].trim();

  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Strip trailing "United States" or "US" — some companies append it redundantly
    const trimmed = /^(united states|us)$/i.test(parts[parts.length - 1])
      ? parts.slice(0, -1)
      : parts;

    if (trimmed.length >= 2) {
      const last = trimmed[trimmed.length - 1];
      // "City, Full State Name" e.g. "South San Francisco, California" → "South San Francisco, CA"
      const stateCode = STATE_CODES[last.toLowerCase()];
      if (stateCode) return `${trimmed[0]}, ${stateCode}`;
      // International "City, Country" — keep as-is
      return `${trimmed[0]}, ${last}`;
    }
    return trimmed[0];
  }

  // Single word or short phrase — check my known city lookup tables
  const lower = s.toLowerCase();
  const knownUs = KNOWN_US_CITIES[lower];
  if (knownUs !== undefined) return knownUs || null;
  const knownIntl = KNOWN_INTL_CITIES[lower];
  if (knownIntl !== undefined) return knownIntl;

  return s;
}

// Every location a posting lists, plus "Remote" when it's a remote role, cleaned up the
// same way as Greenhouse locations ("New York, NY / Remote"). Used for Lever and Ashby.
export function jobLocation(locations: (string | null | undefined)[], remote: boolean): string | null {
  const parts = [...locations, remote ? 'Remote' : null].filter((l): l is string => !!l?.trim());
  return parts.length ? normalizeGreenhouseLocation(parts.join('; ')) : null;
}
