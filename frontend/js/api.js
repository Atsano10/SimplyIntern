// Frontend API client — centralizes all calls to the backend
//
// What goes here:
//   - fetchJobs(filters) — calls GET /api/jobs with query params, returns listings array
//       filters: { keyword, location, type, pay }
//   - This replaces the hardcoded demo data currently in search.js
//   - All other future API calls (e.g. reporting a dead link) go here too
//
// search.js will import and call fetchJobs() instead of using local demo data
