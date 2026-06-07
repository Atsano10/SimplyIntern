// Vercel Serverless Function — GET /api/jobs
//
// This endpoint is the main job fetching route called by the frontend search page.
//
// What goes here:
//   - Accept optional query params: ?keyword=&location=&type=&pay=
//   - Query the Supabase `listings` table for cached job data
//   - Apply filters server-side before returning results
//   - Return a JSON array of normalized job objects:
//       { id, title, company, location, pay, type, url, source, posted_at }
//
// The listings table is populated by the daily-refresh Supabase Edge Function.
// This endpoint only reads — it does not fetch from external sources directly.
