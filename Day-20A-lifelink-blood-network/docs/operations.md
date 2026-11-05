# LifeLink operations

## Error monitoring

Set `SENTRY_DSN` to the project DSN in the backend process environment and set
`SENTRY_ENVIRONMENT` to the deployment name. Leave the DSN empty to disable
monitoring locally. Do not put secret keys in source control.

The server captures unhandled exceptions and server errors. Browser runtime
errors are reported as a fixed event type and a query-free page path through the
same-origin `/api/system/client-error` endpoint; the browser does not submit
exception messages, stacks, form contents, or account data. Sentry events remove
request bodies, cookies, headers, query strings, user context, breadcrumbs, and
exception text. Validate this scrubber with a test DSN before production use.

## Production deployment

### Prerequisites and infrastructure decisions

- Use Node.js 24 or newer; `package.json` declares `"node": ">=24.0.0"`.
  This is a Node.js server application and has no separate frontend build
  command.
- Use a MongoDB replica set or sharded deployment. A standalone server is not
  supported: startup validates the connected topology because application
  lifecycle operations use transactions.
- Configure these environment variable names in the hosting platform's
  secret/environment manager; do not commit their values:
  - Required to start: `NODE_ENV` set to `production`, `MONGO_URI`,
    `JWT_SECRET`, and `PORT` if the host does not inject it.
  - Required for new production uploads: `CLOUDFLARE_R2_ACCOUNT_ID`,
    `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and
    `CLOUDFLARE_R2_BUCKET`. New avatar, prescription, and identity-document
    uploads fail closed if R2 is unavailable; do not rely on ephemeral local
    disk for production uploads. Existing legacy local files still need their
    original persistent location and a separate backup until migrated through
    an approved, verified procedure.
  - Required before identity-document uploads: `ID_DOCUMENT_ENCRYPTION_KEY`.
    It must be the stable 32-byte AES key in the application's required
    64-character hexadecimal format. Back it up separately and securely.
  - Required only when applicable: `TRUST_PROXY_HOPS` when using a trusted
    reverse proxy; `ALLOWED_ORIGIN` for additional browser origins;
    `FRONTEND_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` when
    enabling email delivery; `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`,
    `TWILIO_AUTH_TOKEN`, and the applicable `TWILIO_FROM_NUMBER` or
    `TWILIO_WHATSAPP_FROM` when enabling Twilio messaging; and `SENTRY_DSN`
    when enabling Sentry.
  - Optional tuning/operations names include `MAX_AVATAR_MB`,
    `MAX_PRESCRIPTION_MB`, `HEALTHCHECK_PATH`, `DATABASE_BACKUP_DIR`,
    `BACKUP_RETENTION_DAYS`, and `MONGODUMP_PATH`. Consult `.env.example` for
    descriptions and defaults; its development placeholders are not production
    credentials.
- **External verification required:** Create a private R2 bucket, disable
  public access/custom domains, and issue a credential scoped to only the
  required bucket operations. Verify the policy and permissions in Cloudflare;
  repository configuration does not prove that the bucket or credential is
  correctly restricted.
- **External verification required:** Select an HTTPS-capable hosting and
  reverse-proxy topology. Set `TRUST_PROXY_HOPS` to the exact trusted hop count
  (1-10), prevent direct origin bypass, and configure the edge to replace
  client-supplied forwarding headers. Keep TLS termination and secure
  forwarding behavior verified in staging.
- **Infrastructure decision required:** Define backup retention, recovery
  point/time objectives, approved operators, secret/key custodians, and the
  offsite/encrypted backup destination before accepting real data. The
  repository does not configure hosting, snapshots, monitoring, R2 policies,
  DNS, or secret management.

### Install, start, verify, and roll back

From the project directory, install the locked dependencies and start the
application using the scripts that exist in `package.json`:

```powershell
npm ci
npm start
```

There is no `build` script. Supply the production environment through the
hosting platform; do not copy development placeholders into production. Startup
validates required JWT/port settings, connects to MongoDB with bounded retries,
and does not open the HTTP listener until MongoDB is connected and reports a
replica-set or sharded topology. Configure the host's HTTP port as `PORT` when
it does not inject one. The application handles `SIGINT` and `SIGTERM` with a
bounded 30-second graceful shutdown.

After startup, check `GET /live` for process liveness and `GET /ready` for
readiness. Readiness is HTTP 200 only after startup completes, while MongoDB is
connected, and before shutdown begins; otherwise it returns HTTP 503. The
configured `HEALTHCHECK_PATH` (default `/health`) is also a readiness alias.
`npm run health` checks that configured path and requires the service to be
reachable from the command's host. **External verification required:** check
the public HTTPS route, proxy IP handling, login, email/SMS delivery as
configured, private upload/download authorization, and R2 access in staging;
do not use real identity documents for smoke tests.

For rollback, keep the last known-good application release and its dependency
lockfile available. If a release fails, stop routing traffic to it, deploy the
previous release with its compatible configuration, and verify `/ready` before
restoring traffic. Do not automatically restore MongoDB or roll back database
state with an application release. If a schema/data change is involved, first
confirm backward compatibility and use the separately approved database
recovery procedure; this repository does not provide automatic migrations or
application-version rollback of database writes.

## Daily MongoDB backups

MongoDB Atlas or another managed MongoDB service's automated snapshots and
point-in-time recovery are preferred for production: they run independently of
the application, cover infrastructure failures, and can be retained in a
separate account or region. **Infrastructure verification required:** configure
the provider's snapshot/PITR policy, retention, access controls, encryption,
and restore workflow; none is configured by this repository.

For environments that need `mongodump` archives, install MongoDB Database Tools
on one designated backup host, configure `MONGO_URI` in that host's environment,
and execute:

```powershell
node scripts\backupDatabase.js
```

By default, compressed archives are written outside the application under
`%USERPROFILE%\.lifelink\backups` (Windows) or `~/.lifelink/backups` (Linux/macOS).
Set `DATABASE_BACKUP_DIR` to a private, access-controlled directory to use
another location. Do not place backups in `public`, `uploads`, or a web-served
directory, including using either protected directory itself as the target.
The guard resolves existing symlinks before checking the destination. The
script creates its temporary MongoDB config with a restrictive POSIX mode
request; on Windows, explicitly restrict the backup directory ACL because
mode bits do not establish Windows ACLs. Set
`BACKUP_RETENTION_DAYS` (1–3650; default 14) and optionally
`MONGODUMP_PATH` if the executable is not on `PATH`. The script uses a temporary
restricted-permission config file, gzipped timestamped archives, an exclusive
lock, and removes only expired archives matching its own filename format. If a
process is forcibly terminated and `.backup.lock` remains, verify no backup is
running before removing that lock file manually.

The script's gzip compression is not encryption. **Infrastructure decision
required:** encrypt the backup volume and off-host copy, restrict access to
authorized backup/restore operators, and keep an independently protected
offsite copy. The script retains archives only on its configured backup
directory; it does not upload, encrypt, or verify offsite copies. Its
`mongodump` invocation does not include `--oplog`, so do not treat an archive
made while writes continue as a point-in-time-consistent replica-set backup.
Prefer managed snapshots/PITR for production consistency, or coordinate an
approved write-quiescence/backup procedure and verify it meets the recovery
objectives. Schedule one backup job on exactly one backup host, not on every
application instance.

Schedule the command once per day on exactly one backup host. For Windows, use
Task Scheduler with a daily trigger, the LifeLink project as the working
directory, and `node scripts\backupDatabase.js` as the action. For Linux,
configure a single-host cron job, for example:

```cron
15 2 * * * cd /path/to/Day-20A-lifelink-blood-network && /usr/bin/node scripts/backupDatabase.js >> /var/log/lifelink-backup.log 2>&1
```

Ensure the scheduler environment provides `MONGO_URI`, `DATABASE_BACKUP_DIR`
if customized, `BACKUP_RETENTION_DAYS` if customized, `MONGODUMP_PATH` if
needed, and MongoDB Database Tools. Do not run this as a timer in every
web-server process. The backup must be stored outside the app's public content
and access restricted to the service/backup operators.

### MongoDB restore

Restore only under an approved recovery plan. First identify the incident's
recovery point and intended environment; stop application writes to the
affected database and isolate the restore target. Never restore directly over
production as an exploratory test. Prefer a separate, access-controlled
replica-set staging database and verify the archive there first. Before any
production restore, take a separate provider snapshot/backup of the current
target, record the chosen archive and target, and obtain the required operator
approval.

Use MongoDB Database Tools and a protected configuration file containing the
destination URI rather than putting credentials in shell history or logs. For
example, first validate against an isolated staging target with the archive
copied to a protected path:

```powershell
mongorestore --config="<protected-staging-restore-config.yaml>" --gzip --archive="<protected-archive-path>" --dryRun
```

After confirming the target and dry-run output, perform the approved restore
against that isolated staging database using the same command without
`--dryRun`. Review `mongorestore --help` for the installed Database Tools
version and its config-file format. Do not add `--drop` or broad namespace
options unless the approved recovery plan explicitly requires them: they can
replace existing collections/data. For production recovery, repeat only after
the staging validation and explicit target/impact review; use the approved
target-specific restore procedure and maintain the pre-restore snapshot for
rollback. The application never restores a backup automatically.

After restore, verify expected database name, collections, indexes, document
counts or other approved integrity checks, transaction-capable topology, and
application `/ready` status before restoring traffic. Validate critical
workflows with synthetic accounts/data in staging. Reconcile R2 object
references and cleanup state before enabling deletion workers if the database
was restored to an older point than object storage. **Infrastructure decision
required:** define the exact recovery approval, target selection, consistency
checks, and acceptable data-loss window; they cannot be inferred from this
repository.

## Incident response and recovery decisions

### MongoDB outage

Use `/ready` as the traffic/readiness signal; it returns HTTP 503 when MongoDB
is disconnected. Follow the database provider's incident process and confirm
connectivity and transaction-capable topology before returning traffic. Do not
restore a backup merely because of a transient outage. Choose point-in-time
recovery only after assessing data loss and consistency, and restore to an
isolated target for validation first. If the database was restored to an older
point than R2, review the cleanup/reconciliation state and object references
before allowing workers to delete objects.

### R2 outage or access-policy change

New production uploads are designed to fail closed when R2 is unavailable;
local ephemeral storage is not a production substitute. Existing object reads
or cleanup may fail while the provider or credentials are unavailable. Check
the Cloudflare service status, bucket access policy, credential scope, and
application error monitoring without copying secrets into logs or tickets.
Do not delete or reset queued cleanup jobs to clear errors. Once access is
restored, review pending/failed cleanup jobs and reconciliation status, verify
database references, and let the worker retry through its existing bounded
process. If there is evidence of unintended deletion, take the application
instances out of service to stop their background workers while preserving
database and provider evidence; follow the approved R2 recovery procedure.

**External verification required:** Decide whether provider-supported object
versioning, retention, or an independent encrypted object backup is required,
and configure and test it before production. Do not assume it is enabled.
Retention/versioning choices must be reviewed against user deletion and privacy
requirements. MongoDB backups do not contain R2 objects, and R2 object copies
do not contain MongoDB metadata.

### Identity encryption-key loss or compromise

Treat key loss and key compromise as different incidents:

- **Key lost or unavailable, with no evidence of exposure:** Stop identity-
  document upload, verification, and download workflows. Retrieve the exact
  original key from its secure recovery copy and restore it through the
  deployment's approved secret-configuration process. A new key cannot decrypt
  existing documents. If every copy of the original key is lost, those
  documents are unrecoverable unless a separately protected, usable plaintext
  recovery copy exists.
- **Key exposed or suspected compromised:** Restrict access to the affected
  secret and preserve relevant access records and evidence. Follow the
  organization's secret-incident and privacy-response procedures to assess
  potential access to encrypted documents. Do not delete the old key or
  overwrite it as an immediate response: the old key is still needed to read
  existing documents during any controlled migration. Plan replacement and
  re-encryption as a separate, verified operation.

In either case, do not put key material in incident tickets, logs, screenshots,
or support messages. There is no automated key recovery or rotation in the
application.

### Failed cleanup and reconciliation work

Inspect failed cleanup jobs and the per-purpose
`StorageReconciliationState` documented above. Determine whether the cause is
database availability, R2 permissions, reference-query failure, or an object
operation failure. Resolve the cause and verify that reference checks work
before retrying. Do not manually delete potentially referenced objects, remove
cleanup intent, or advance/clear a failed reconciliation cursor. If a database
restore changed references, reconcile that state with R2 before resuming
deletion workers. Escalate when retry state could not be persisted during a
database outage; a process-local safeguard does not survive restart.

### Rollback versus data restore

Rollback the application release when the failure is isolated to application
code and the previous release is compatible with current data and
configuration. Restore MongoDB only when the incident requires recovery of
database state and the selected recovery point, data loss, and impact are
approved. These are separate actions: an application rollback does not roll
back database writes. Before any database or object-store recovery, preserve
the current state where possible, validate the recovery source in isolation,
and define when traffic and background deletion workers may safely resume.

**Operational gap:** The repository provides Sentry integration and health
endpoints but does not prove that alerts, backup-job monitoring, R2 audit
alerts, on-call ownership, or an incident-response service are configured.
Verify alert delivery and escalation in staging and assign an operator for
each recovery decision before launch.

## External notification configuration

Email requires `FRONTEND_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and
`SMTP_PASS` as documented in `.env.example`. For Gmail, set `SMTP_HOST` to
`smtp.gmail.com` and `SMTP_PORT` to `465` (implicit TLS) or `587` (required
STARTTLS). `SMTP_USER` is both the authorized Gmail login and sender address;
`SMTP_PASS` must be its Google App Password, never the normal account password.
The sender setting `SMTP_FROM` and transport toggle `SMTP_SECURE` are not used.
Run `node scripts/testGmailDelivery.js` to send a plain-text test message to an
address you control. The script confirms SMTP acceptance only; check the inbox
and spam folder to confirm receipt. Phone messages require `SMS_PROVIDER=twilio` or
`SMS_PROVIDER=twilio-whatsapp`, the matching Twilio account credentials, and a
configured sender. Only verified channels opted into by the user are eligible.
Twilio API acceptance is recorded as `Sent`, not `Delivered`; no delivery
receipt webhook is currently configured. Do not use real recipients for
application notification tests; the SMTP test script should only target an
inbox you control.
Verification resend throttling is keyed by a normalized, hashed account email,
not the client's IP. The limit is 30 requests per account;
`VERIFY_RESEND_WINDOW_SECONDS` and `VERIFY_RESEND_COOLDOWN_SECONDS` default to a
30-minute window and a 60-second cooldown. A retry response includes
`Retry-After`. Administrators can
verify an account from the user list; the action is audited, records its method
and timestamp, and invalidates outstanding email-verification tokens.
Critical requests are dispatched in batches of 100 recipients, with 30 seconds
between batches. A MongoDB lease and per-recipient/channel unique notification
key make processing safe across multiple application instances. Notification
payloads are durably queued in MongoDB; each notification is attempted up to
five times with increasing delays. A worker also reclaims stale `Sending` records
after a one-minute lease, so a process exit does not strand a notification.
Retries are at-least-once: a process may stop after a provider accepts a message
but before MongoDB records success, so a recipient could receive a duplicate.
After the final attempt, inspect records marked `Failed`. Stop all app instances
to stop dispatch. Eligible donors who have provided a recent
donation date receive at most one preference-gated eligibility reminder per
day; the scheduled task uses a MongoDB lease so only one app instance runs the
reminder scan at a time.

### In-app notification inbox

In-app notifications are stored separately from external delivery records in
`InAppNotification`; channel preferences do not disable the inbox. The
authenticated API uses the current account as the recipient and does not accept
a recipient ID:

- `GET /api/notifications/inbox?page=1&limit=20` lists newest notices; `limit`
  is capped at 50.
- `GET /api/notifications/inbox/unread-count` returns the unread count.
- `PATCH /api/notifications/inbox/:id/read` marks one owned notice as read.
- `PATCH /api/notifications/inbox/read-all` marks all of the current user's
  notices as read.
- `DELETE /api/notifications/inbox/:id` deletes one owned notice.

The inbox is deduplicated by event and recipient. Offer submission and
acceptance notices are written with their corresponding business change in the
existing MongoDB transaction; therefore the same replica-set or sharded MongoDB
deployment requirement applies. New-request, decline, request-close, completion,
and verification notices are dispatched after their business operation and
cannot turn a successful operation into a failed response. Their helper logs
only the failure code/name, and a duplicate event is ignored. External email,
SMS, and WhatsApp delivery remains separate from the inbox. The current project
does not provide an admin-announcement workflow.

## Support tickets and helpline

The public contact form submits tickets to `POST /api/support/tickets` and is
limited to five submissions per IP per hour. A hidden honeypot field provides
basic spam filtering; it is not a substitute for monitoring abuse. Signed-in
users can read only their own tickets at `GET /api/support/tickets/mine`.
Administrators can list and filter tickets at
`GET /api/support/admin/tickets` and update status or add a reply with
`PATCH /api/support/admin/tickets/:id`. Ticket messages and replies are private
and are not sent by email or WhatsApp; users see replies on the Contact page.
Specific retention periods remain a launch/legal-review requirement.

The confirmed support phone is `+923240128349`. The footer and Contact page
provide a `tel:` link and a `https://wa.me/923240128349` chat link. This is a
click-to-chat link, not an automated WhatsApp integration. Do not claim message
delivery or send real messages during tests.

## HTTP security, proxy, and rate limits

The server sets a restrictive same-origin Content Security Policy and standard
anti-framing, MIME-sniffing, referrer, and permissions headers. Keep scripts and
styles in external files; do not add inline scripts or styles without updating
the policy deliberately. Rate-limit counters are stored in MongoDB with hashed
client keys and a TTL index, so limits are shared across application instances.
If the service is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact
number of trusted proxy hops (1–10); do not use a blanket trust-all setting.
Avatar, prescription, and identity-document uploads have separate per-account
hourly limits (10, 5, and 3 uploads, respectively). The limit runs after
authentication and before multipart parsing, and uses the authenticated account
ID; its IP fallback uses Express's client IP with IPv6 normalization. Rate
counters are MongoDB-backed and shared across app instances.

Configure `TRUST_PROXY_HOPS` only when the deployment proxy topology is known.
The application must not be directly reachable around that proxy, and the proxy
must replace/normalize forwarded client-IP headers rather than trust client
supplied values. Verify that `req.ip` resolves to the actual client in staging;
an incorrect hop count can make IP-based fallback limits spoofable or group
unrelated clients together. The application limits uploads by account, but
does not replace hosting-level request-body limits, connection/time limits,
abuse monitoring, or a WAF/CDN rule set. Configure those at the edge and test
them without bypass paths before public launch.

## Optional Cloudinary storage adapter

The Cloudinary SDK and a server-side adapter are available, but Cloudinary is
not wired into the upload routes. Avatar and prescription uploads use Cloudflare
R2 when its server-side configuration is complete and retain the existing local
behavior when R2 is unavailable. Existing local files and filename references
remain supported; setting `CLOUDINARY_URL` alone does not change upload
behavior.

If configuring the adapter for development or a deployment, provide
`CLOUDINARY_URL` as a server-process environment variable or deployment secret.
It contains account credentials: never put a real value in `.env`, source
control, browser code, logs, or support output. The adapter accepts only avatar
and prescription purposes, assigns random asset IDs, and requests authenticated
Cloudinary delivery. It does not return public or signed delivery URLs.

Identity documents are excluded from Cloudinary. When R2 is configured, the
identity-document route encrypts the file with AES-256-GCM before storing the
ciphertext in the private R2 bucket. Without R2, it retains encrypted local
storage under `uploads/identity-documents`. Never upload plaintext identity
documents to object storage or Cloudinary.

## Private R2 storage and cleanup

Configure `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and `CLOUDFLARE_R2_BUCKET` in the server's
secret manager. Credentials stay server-side; do not make the bucket public or
return object URLs to clients. Grant the application credential only the
bucket-scoped object read, write, list, and delete permissions required by the
storage workflows. Before deployment, verify in the Cloudflare dashboard that
public bucket access and public custom domains are disabled, and confirm the
credential is scoped to this bucket with only the required operations. Do not
use a public URL for private prescriptions or identity documents.

Identity-document encryption also requires `ID_DOCUMENT_ENCRYPTION_KEY` in the
server secret manager. Back up this key separately from the encrypted document
backup using an access-controlled secret-backup process, and test key recovery
before accepting production documents. Never put the key in source control,
logs, or an operational report.

R2 metadata is optional and hidden from ordinary user-facing queries. Records
without storage metadata continue to use their existing local filename. No
bulk migration is performed by application startup; migrate existing files
only through a separately backed-up and verified migration procedure.

Obsolete R2 objects are written to the `StorageCleanupJob` collection as durable
cleanup jobs. The worker starts with the application, does not make an R2 call
immediately at startup, and checks all live avatar, prescription, and identity
document references before deletion. Leases allow recovery of abandoned
processing jobs; delete retries use exponential backoff and stop after eight
failed attempts. When R2 is configured, a bounded bucket scan also queues old,
unreferenced objects for reconciliation after a 24-hour grace period. Review
failed cleanup jobs and R2 access errors through operational monitoring; never
delete a job's object manually without checking database references first.

Request deletion, document withdrawal, and replacement do not synchronously
delete R2 objects. They enqueue cleanup intent; jobs remain pending while R2 is
unavailable. The worker and reconciliation scan require MongoDB and an available
R2 configuration, and completed/failed job records are retained for
idempotency and diagnosis. Local legacy-file cleanup remains separate.

Reconciliation tracks a separate state for each purpose (`avatars`,
`prescriptions`, and `identity-documents`). If a page repeatedly fails, its
attempt count increases with capped exponential backoff; after the configured
maximum, its state becomes `failed` and the worker stops scanning that purpose.
Identify failed purposes by inspecting the corresponding
`StorageReconciliationState` document's `_id`, `status`, `attempts`, and
`lastErrorCode` fields using approved, read-only database access. Safe error
codes distinguish listing, reference-check, cleanup-queue, and cursor-update
failures; do not copy credentials, object contents, or identity data into
diagnostic output.

Before recovery, review the recorded error and relevant worker/R2/database
health logs, verify that reference checks can complete, and confirm cleanup
queue/database health. Resolve the cause first. Then, through the approved
database maintenance procedure, reset only that purpose's retry state to
`status: "active"`, `attempts: 0`, `lastErrorCode: null`, and an eligible
`nextAttemptAt`; preserve its existing `continuationToken`. Do not manually
advance or clear the cursor after a failed page. A failed page may have only
partially enqueued cleanup jobs, so retrying the same cursor is intentional;
enqueueing is idempotent. Verify that the worker resumes from that cursor and
monitor the resulting state and cleanup jobs. Do not delete objects manually
as a substitute for reconciliation.

If MongoDB is unavailable while reconciliation retry state is being persisted,
the failed attempt, backoff time, or terminal state may not be durably recorded.
The worker blocks that purpose for the current process when this update fails,
but that process-local safeguard does not survive a restart. The stored lease
may remain until it expires, and no bounded retry guarantee can be made until
MongoDB accepts the state update. Restore database availability, inspect the
persisted state and lease, and follow the recovery procedure above; do not
assume an unrecorded attempt was counted.

Production MongoDB must be configured as a replica set or sharded deployment
that supports multi-document transactions. R2-backed avatar and prescription
replacement, identity-document replacement and withdrawal, and request
deletion rely on transactions to commit reference changes together with cleanup
intent (and related audited changes where applicable). A standalone MongoDB
server is not supported for these lifecycle operations; verify transaction
support before enabling public production uploads.

Admin identity and hospital changes are paired with audit records in a MongoDB
transaction when connected to a replica set or sharded cluster. A standalone
MongoDB instance uses compensating rollback if an audit insert fails; production
should use a replica set so the state change and audit record commit atomically.

Requester and donor accounts must verify their email before signing in. The
separately provisioned admin role is exempt because it is created by the
operator-controlled admin script. Signup, reset, and admin creation require
passwords of at least eight characters (maximum 72 UTF-8 bytes).

## Hospital directory

Administrators manage entries in the admin workspace or through the protected
`/admin/hospitals` API. New entries start as `Pending`; public blood-group
availability is shown only when both the facility and its inventory have been
verified. Changes to a facility entry return it to `Pending`, and changing the
blood-group list clears inventory verification. Verify facilities and stock
only after independently checking the details with the provider. Removal is a
soft delete; the audit record is retained. The public directory and details are
available at `hospitals.html` and `hospital.html`.

## Donation completion confirmation

An accepted offer is not counted as a completed donation until both the donor
and requester independently confirm completion. Each participant can add an
optional note of up to 300 characters; notes and confirmation timestamps are
private offer records and are not displayed publicly. No evidence files are
collected. Only after both confirmations does LifeLink update donation history,
eligibility dates, and fulfilled request totals. Disputes or failed delivery
should be handled through the existing report and admin review workflows.

## Ratings and reviews

Only the donor or requester attached to a completed offer can submit one
rating per offer. New reviews remain pending until an administrator publishes
or rejects them in the admin workspace. Rejected reviews can be revised and
resubmitted by their author. Public profile summaries and donor search results
include only published reviews. Do not treat ratings as medical advice or as
proof that a participant or facility has been independently verified.

## Private identity-document review

Identity-document uploads are optional and require explicit user consent. The
server accepts PDF, JPG/JPEG, or PNG files up to 5 MB, checks their file
signatures, and encrypts the bytes with AES-256-GCM before writing them under
`uploads/identity-documents`. Only the random encrypted filename and MIME type
are stored on the user record. The directory is outside `public`; administrators
must be authenticated to download a document, and each download and decision is
audited. Uploading does not mark a user verified: an administrator must review
the document manually.

`ID_DOCUMENT_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters
representing 32 cryptographically random bytes. The application uses this key
with AES-256-GCM; each document gets its own random 12-byte IV and a 16-byte
authentication tag. The key is not stored in MongoDB or alongside the encrypted
files. The placeholder in `.env.example` is not a usable key.

Generate a key locally in PowerShell with Node.js crypto:

```powershell
$key = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
```

This command creates a new key in the PowerShell variable `$key`; assignment
does not print its value. Do not run a command that echoes the variable. Set
`ID_DOCUMENT_ENCRYPTION_KEY` through the approved secret manager or trusted
local configuration process. Do not paste the value into chat, source control,
screenshots, logs, or support messages.

To check the value configured in the current PowerShell process without
displaying it, run:

```powershell
$configuredKey = [Environment]::GetEnvironmentVariable('ID_DOCUMENT_ENCRYPTION_KEY', 'Process')
if ($null -ne $configuredKey -and $configuredKey -cmatch '^[A-Fa-f0-9]{64}$') {
  'ID_DOCUMENT_ENCRYPTION_KEY format is valid.'
} else {
  'ID_DOCUMENT_ENCRYPTION_KEY format is invalid or missing.'
}
```

Keep the active key in an operating-system or deployment secret manager in
production, not in source control or application files. Make an encrypted
backup of the key separately from both the application backup and the database
backup. Restrict access to authorized operators and maintain a recovery copy in
a separate secure location with appropriate access controls. Periodically
verify that an authorized operator can retrieve the backup and that its
format is valid; do not include the key in verification output or records.

Restrict filesystem permissions on `uploads/identity-documents`; Windows
installations should configure the directory ACL explicitly because POSIX mode
bits are not an ACL. Back up encrypted document files separately from MongoDB
using an access-controlled encrypted backup. Protect and recover the key
independently from those backups.

### Key recovery procedure

If the configured key is missing or unavailable:

1. Retrieve the original key from its secure recovery copy. Do not generate a
   replacement key for recovery.
2. Restore it through the deployment's approved secret-configuration process.
   Do not place it in source code, a checked-in file, a ticket, or a log.
3. Verify that the configured value is exactly 64 hexadecimal characters using
   the format-check command above; confirm only the status, never the value.
4. Restart the affected application instances, or use the deployment's
   approved safe reload procedure, so the process receives the restored secret.
5. In a controlled environment, use an authorized synthetic test document to
   verify encryption and decryption with the restored configuration.
6. Confirm through the authorized identity-document review workflow that
   existing encrypted documents remain readable. Avoid bulk exports or
   unnecessary plaintext copies during verification.

Test key and encrypted-document backup recovery before accepting real identity
documents, then repeat the recovery check periodically without exposing the
key.

Replacing `ID_DOCUMENT_ENCRYPTION_KEY` directly makes documents encrypted with
the old key unreadable. Never rotate the key by simply replacing the configured
value. A future rotation requires a separately designed, controlled migration
that decrypts each existing document with the old key and re-encrypts it with
the new key. The migration must include verified backups, per-document
integrity checks, a tested rollback plan, and restricted access. Keep the old
key securely available until migration, recovery, and readability checks have
been verified. The current application does not implement automated key
rotation.

Uploaded files remain encrypted until the user withdraws verification or
replaces the document. Withdrawal clears the user reference and queues R2
ciphertext for cleanup, or removes the legacy encrypted local file. Do not
retain downloaded admin copies after review.

## Request and offer concurrency

Creating blood requests, creating donor offers, and accepting offers use MongoDB
transactions to serialize capacity checks with their writes. The transaction
callbacks use MongoDB's retry behavior for transient write conflicts; failed
checks roll back their sequence claim and do not leave a partial request or
offer. The request/donor sequence fields are internal coordination values and
do not change the existing request or offer limits.

These operations require a MongoDB replica set or sharded deployment. A
standalone MongoDB server cannot provide multi-document transactions, so the
affected operations return an explicit service-unavailable error until the
deployment supports transactions. Configure even a single-node local MongoDB
as a replica set for development. Application startup validates the MongoDB
URI, makes up to three bounded connection attempts, and refuses to start unless
the connected topology is a replica set or sharded deployment. Connection
errors are reported without logging the URI or credentials. Verify the topology
before relying on request/offer creation or acceptance. The integration
concurrency suite uses
`LIFELINK_TEST_MONGO_URI` only when it points to an isolated loopback database
whose name ends in `test`; use a replica-set test instance and never point it at
application or production data.

## Local development

Copy `.env.example` to `.env`, set a local or hosted `MONGO_URI` and a long
random `JWT_SECRET`, then run `npm install` and `npm start` from the project
directory. The health endpoint is `http://127.0.0.1:3000/health` unless
`PORT`/`HEALTHCHECK_PATH` is changed. Leave Sentry and messaging credentials
unset when testing locally; email/SMS delivery will not be available.
