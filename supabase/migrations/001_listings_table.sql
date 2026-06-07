CREATE TABLE IF NOT EXISTS listings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL,
  company    TEXT        NOT NULL,
  location   TEXT,
  pay        TEXT,
  type       TEXT,
  url        TEXT        UNIQUE NOT NULL,
  source     TEXT        NOT NULL,
  posted_at  DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listings_company_idx   ON listings (company);
CREATE INDEX IF NOT EXISTS listings_source_idx    ON listings (source);
CREATE INDEX IF NOT EXISTS listings_posted_at_idx ON listings (posted_at DESC);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

-- Anyone (logged in or not) can read listings
CREATE POLICY "Public read" ON listings
  FOR SELECT USING (true);

-- Only the service role (Edge Function) can write
-- Insert/update/delete are blocked for anon/authenticated roles by default
