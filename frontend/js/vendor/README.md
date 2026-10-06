# Vendored scripts

Third-party code served from our own domain instead of a CDN. That way the CSP can be
`script-src 'self'`. Allowing a public CDN like cdn.jsdelivr.net would let an injected
`<script>` load anything anyone has published to npm. It also means a new release
can't change the site without us choosing to update.

## supabase-2.117.2.js

`@supabase/supabase-js` 2.117.2, file `dist/umd/supabase.js`, unmodified.

Verified 2026-10-06: the npm tarball matched its published `dist.integrity`
(sha512-eSG2VKnHR+Clp1PmidZ1/weJ8PJwoybjva3L2GgKqFG4YDS1Iqmc61psKGZP5xw6OMT2O7ZorPR42PY6q1BOXg==).

To update:
1. `npm pack @supabase/supabase-js@<version>`. npm checks the tarball's integrity.
2. Extract `package/dist/umd/supabase.js` to `supabase-<version>.js` here and delete
   the old file.
3. Change the `<script src="js/vendor/supabase-….js">` tag in every `frontend/*.html`.
   The build fails if a page still points at the old file.
