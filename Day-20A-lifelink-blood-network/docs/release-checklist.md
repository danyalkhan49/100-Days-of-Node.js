# LifeLink release checklist

## Final coding regression review — 2026-11-03

### Verified offline

- [x] Authentication and authorization: token/session checks, role restrictions,
  email verification, password handling, and rate-limit behavior reviewed; the
  offline auth tests pass.
- [x] Requests and offers: authorization, donor eligibility, capacity limits,
  transaction requirements, expiry, and cancellation paths reviewed; the
  offline request/offer tests pass.
- [x] Donation completion: the reviewed flow requires donor and requester
  confirmation and commits offer, request capacity, donor history, and final
  status inside a required MongoDB transaction.
- [x] Notifications: inbox ownership, deduplication, and event triggers reviewed;
  provider delivery tests use mocks and do not contact external services.
- [x] Uploads and storage cleanup: offline tests cover validation, private access,
  encryption, checksums, safe local paths, queued deletion, retries, and orphan
  reconciliation using temporary files or fake storage clients.
- [x] Health and lifecycle: liveness/readiness tests and safe startup-failure and
  graceful-shutdown tests pass. No server was started against a real database.
- [x] Public hospital links: admin input already requires HTTP/HTTPS; the
  hospital detail page now also suppresses unsafe legacy URLs. A synthetic UI
  test covers safe and unsafe schemes.
- [x] Configuration inventory: documented the optional `ADMIN_*` variables
  consumed by the one-time admin creation script in `.env.example`.
- [x] Environment/monitoring isolation: importing `server.js` no longer loads
  `.env` or initializes Sentry. Local `.env` loading and monitoring setup happen
  during server startup. The startup configuration test uses a synthetic file.
- [x] `npm.cmd test`: **284 passed, 0 failed, 0 skipped** on 2026-11-03.
  The suite uses offline fakes/mocks and temporary test data.
- [x] Static frontend checks: all 70 local HTML/CSS references resolved; all
  statically referenced browser DOM IDs exist. JavaScript syntax checks passed
  for all 119 JavaScript files.

### Remaining review risks

- Browser bearer tokens are stored in `localStorage` in `public/js/common.js`.
  Current output escaping and the restrictive same-origin script policy reduce
  exposure, but any future same-origin script injection could read a token.
  Keep this risk in the security review when changing script sources or session
  handling.
- Browser behavior and responsive layout received static review only; no full
  browser-driven cross-device test suite is present.

### Deployment gates still open

- [ ] Run request/offer concurrency integration tests against an isolated,
  loopback MongoDB replica set. The integration test is intentionally excluded
  from the offline `npm test` command and requires `LIFELINK_TEST_MONGO_URI`.
  It was explicitly run with that variable unset and skipped safely; no database
  connection was attempted.
- [ ] Verify production startup and transactions against the actual staging
  MongoDB replica set or sharded deployment.
- [ ] Configure and verify private Cloudflare R2 access, scoped credentials,
  object lifecycle/cleanup behavior, and upload/download flows in staging.
- [ ] Securely provision and back up the stable identity-document encryption
  key before enabling identity-document uploads.
- [ ] Verify HTTPS hosting, reverse-proxy trust settings, origin restrictions,
  DNS, and health/readiness routing in staging.
- [ ] Configure and verify secret management, email/SMS delivery (if enabled),
  monitoring, database backups, retention, and a restore exercise.
- [ ] Complete staging smoke tests with synthetic accounts and files, then review
  rollback readiness before any production release.

The offline coding regression is complete. These infrastructure and staging
checks have not been performed, so this review does not establish production
readiness or authorize deployment.
