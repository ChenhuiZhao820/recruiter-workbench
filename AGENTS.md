# Capture

A private workspace for a recruiter's pipeline. The main application never contacts
LinkedIn: it only builds a profile or search URL and opens it on a user click.
The optional Capture extension uses a toolbar click for one active-tab
profile read via `activeTab` and `scripting`. No LinkedIn host permissions,
registered content scripts, background page reading, bulk capture, polling,
crawling or automated messaging. Fields remain editable, notes are written only
by the user, and saving requires a user click. This click-triggered exception
supersedes the former blanket prohibition on extensions and page reading.

The hosted-account version extends the original capture specification: source
extensions remain HTTP loopback-only; packaged extensions additionally allow one
explicit HTTPS workbench origin. Runtime validation, CSP and redirect refusal
keep requests scoped. Never add arbitrary HTTPS or LinkedIn host permissions.

## Commands

- Node 22.14+ is required for the SQLite migration tooling and its tests.
- Dev server: `npm run dev` (http://localhost:3000)
- Local build + typecheck: `npm run build`
- Lint: `npm run lint`
- Typecheck without a build: `npx tsc --noEmit`
- Unit/regression suites: `npm run test:unit`
- Extension-only regression tests: `npm run test:extension` (mocked DOM, Chrome APIs
  and fetch; no live LinkedIn/browser/network needed)
- Full suite: `npm test` (unit tests followed by Playwright and the local AI stub)
- Playwright creates a fresh `prisma/test-<uuid>.db` for each run. Configuration
  propagates `CAPTURE_TEST_DATABASE_URL` to helpers/workers/server; setup refuses
  existing targets and teardown removes only that run's files. On Windows, if
  the test server still holds the database open, teardown retains it and its
  sidecars with a warning rather than forcing deletion. Never use dev.db or the
  legacy test.db as a test target.
- PostgreSQL schema sync/check: `node scripts/prepare-postgres.mjs [--check]`
- Hosted build: `npm run build:hosted`
- Authorized PostgreSQL migrations: `npm run db:deploy:hosted`
- Restore local SQLite Prisma client after a hosted build: `npm run db:client:local`
- Package a hosted extension: `npm run extension:package -- --origin <HTTPS_ORIGIN>`.
  Output is `dist/capture-extension`; existing output is refused, never deleted.

## Branding

- Product, browser extension and UI name: Capture. npm package name: capture.
- Test environment variables use CAPTURE_TEST_; packaged extension configuration
  uses CAPTURE_WORKBENCH_ORIGINS. Do not rename user/company emails or saved data.
- New sessions use capture_session (with __Host- on HTTPS). The former
  basanite_session name is accepted only as a legacy fallback when no new cookie
  exists. Logout revokes and clears both names; never fall back from an invalid
  new cookie to an older account. Preserve this compatibility until deliberately
  retired rather than treating it as a leftover brand label.
- Repository/directory names and hosted database/service names are independent
  resources. Changing display branding must not silently change origins or URLs.

## Frontend design and public routes

- Visual direction: Aoutive-inspired structured grids, restrained borders, black /
  white / neutral grays and cobalt blue (#315CFF) as the single brand accent.
  Do not introduce the separate Basanite interview product's earth/gold palette.
- Fonts stay local (Schibsted Grotesk and JetBrains Mono). Illustrations are inline
  SVG/CSS, not hotlinked template assets; no new third-party runtime requests.
- Anonymous `/` is a public marketing homepage. Authenticated `/` remains the
  owner-scoped Roles dashboard. `/welcome` shows the marketing page for either
  state. All other business routes still require authentication.
- `ApplicationShell` selects public navigation or the responsive workspace sidebar;
  `MarketingHome`/`ProductPreview` use explicitly illustrative, static data only.
  Never feed real recruiting data into a public preview or invent customer claims.
- Dashboard search/sort in `RoleDirectory` works only on server-authorized records
  and does not write data. Keep all mutation labels, owner checks and read-only
  protections intact when restyling pages.
- `tests/06-design.spec.ts` covers public/private routing, mobile overflow, keyboard
  navigation, tabs, FAQ, password visibility and role filtering. Screenshots use
  test-only fixtures in ignored test-results; no real user data is captured.

## Accounts and authorization

- `lib/auth.ts`: opaque hashed database sessions, HttpOnly/SameSite cookies,
  fixed expiry, active-account and auth-version checks, same-origin action checks.
- `lib/auth-crypto.ts`: native scrypt password hashing and SHA-256 token hashes.
- `lib/workspace.ts`: `getWorkspace()` supplies the owner for every business read;
  `requireWritableWorkspace()` guards every business mutation. Never trust an
  owner/user ID submitted by a client. Scope direct IDs and related IDs alike.
- Role, SavedSearch and MessageTemplate have userId; candidates, briefings and
  outreach inherit ownership through their parent relations. Settings is per user.
- Admin creates recruiter accounts with one-time activation links, not passwords.
  Admin can view other workspaces read-only, with a persistent banner and audit.
  Viewing is stored on the session, not a user impersonation or role change.
- Capture uses a per-user hashed key, independent of website cookies. Its API
  returns the connected account and only its open roles. Password changes and
  account disabling revoke sessions and capture keys; no raw stored capture keys.
- Public signup is disabled. Activation links use URL fragments and expire after
  24 hours; the raw link is shown only at creation. No default admin password.

## Extension activation and downloads

- Extension access is account-bound, separate from password setup and capture keys.
  `ExtensionAccess.userId` is the primary key; `codeHash` is unique and hash-only.
- Admin issues or replaces one pending code per active recruiter. Each code expires
  after 7 days. Replacement invalidates the old code; redemption is atomic, once,
  self-scoped and throttled. Activated accounts cannot receive another code.
- Active admins are exempt. Ordinary accounts (including existing ones) must redeem
  before downloading, generating capture keys or calling either capture API method.
  A forwarded ZIP does not grant access. Read-only workspace views cannot issue,
  redeem or download; account disabling still revokes sessions and capture keys.
- Account activation persists after the code is consumed, across reinstalls and
  password changes. The ZIP may be downloaded again; capture keys remain separate
  and must be generated in Settings. No personal secrets are packaged.
- `/api/extension/download` is authenticated, private/no-store and serves only five
  allowlisted extension files. Shared packaging in `lib/extension-package.mjs`
  uses the configured APP_ORIGIN (exact HTTPS host or local development loopback).
  Never move ZIPs into public/ or trust a request-supplied workbench origin.
- Installation still requires desktop Chrome Developer mode / Load unpacked. No
  silent installation or automatic unpacked-extension updates are promised.
- Deploy the additive `20260910000000_extension_access` PostgreSQL migration before
  serving the new app. Do not edit the old initial migration or apply changes to
  real local/hosted databases without approval. Builds do not apply migrations.
- `tests/07-extension-access.spec.ts` covers activation, download, forged requests,
  API permissions and read-only views. Unit tests cover code lifecycle and ZIPs.

## Setup and migration safety

- `.env.example` describes a NEW local account database. Do not overwrite an
  existing `.env` or point the new schema at legacy dev.db without a migration plan.
- `APP_ORIGIN` must equal the actual browser origin, including the port. It is
  required in production and must be HTTPS except for loopback development.
- `ANTHROPIC_API_KEY` is server-side and only needed for briefing generation.
  Hosted users share the deployment's AI service; no external calls in tests.
- Prisma remains v6. The source schema is SQLite; the generated PostgreSQL schema
  and its migrations are under `prisma/postgresql`. Do not run the old SQLite
  migration history to initialize the new account schema.
- To initialize a NEW local account database only:
  `npm run db:init:local -- --path <ABSOLUTE_NEW_DB_PATH>`. Existing files are refused.
- Initialize hosted databases only after explicit deployment approval. Build
  commands generate clients but do not run migrations or import data.
- Before migrating real data, stop the old app, make a verified backup, and obtain
  explicit approval for the target and operation. The import source is read-only.
- Order: initialize fresh target -> bootstrap Admin -> import legacy data ->
  activate/sign in -> create Paul. Import must happen BEFORE first workspace use,
  because even a default Settings row makes the target nonempty.
- Set DATABASE_URL explicitly for CLI account scripts (they do not load .env).
  Bootstrap: `npm run accounts:bootstrap -- --email <ADMIN_EMAIL> --origin <ORIGIN>
  --output <NEW_PRIVATE_FILE>`. It creates no password and writes a one-time link
  exclusively to that file, not the console. On Windows use a private ACL-protected
  directory; Unix file mode alone is not a Windows access control.
- Import preview: `npm run accounts:import -- --source <LEGACY_DB_PATH>
  --admin-email <ADMIN_EMAIL>`. Default is dry-run/counts only.
- Actual import adds `--apply` and requires typing `IMPORT` in an interactive
  terminal. It refuses nonempty targets, preserves IDs/relations, assigns all old
  data to Admin, and invalidates old capture keys. It never clears a target.
- Verified local backup: `node scripts/backup-legacy.mjs --source <OLD_DB>
  --target <NEW_DB> --directory <PRIVATE_DIRECTORY>`. It checks target absence,
  creates a read-only-source VACUUM snapshot, compares content and records checksums.
  `--check` instead of `--directory` only performs preflight.
- Post-import verification: `node scripts/backup-legacy.mjs --verify <REPORT_JSON>
  --admin-email <ADMIN_EMAIL>`. It opens the target read-only and checks every
  migrated field, ownership, audit records and unchanged source/backup checksums.
- `prisma/private-local/` is ignored: it contains local backups, verification
  reports and one-time activation files. Never print activation-file contents.
- In this Windows PowerShell environment, npm's wrapper can consume script flags.
  Use `node scripts/<script>.mjs --flag ...` directly for parameterized operations.
  The agent's Windows terminal does not support PTY; the user must type `IMPORT`
  in their own interactive terminal. Do not bypass the import confirmation gate.

## Multi-account SQLite to PostgreSQL migration

- Use `scripts/import-accounts.mjs` for the current accounts.db format. The legacy
  importer above is only for the earlier single-user dev.db format.
- Preserve User IDs, password hashes, account state, all business ownership and
  relations, timestamps and historical audit events. Increment authVersion,
  clear captureTokenHash, and do not import sessions, activation links or throttles.
- The selected `--admin-email` must already be an active Admin with a supported
  password hash, so the destination cannot be left without a usable administrator.
- Before an authorized cutover, stop writes to the local app and create a NEW
  private snapshot using `node scripts/import-accounts.mjs --source <ACCOUNTS_DB>
  --admin-email <EMAIL> --snapshot <NEW_PRIVATE_SNAPSHOT>`. Existing output is refused.
- Initialize an EMPTY PostgreSQL target using the hosted schema migrations. Do
  NOT bootstrap another Admin first. All target account/business/auth/audit tables
  must be empty; even a login-throttle row will cause a safe refusal. Keep the
  destination app offline until import/verification finishes.
- Run the importer from a separate migration checkout with the PostgreSQL Prisma
  client generated. Do not replace the client in a running local SQLite app.
  Set the target PostgreSQL DATABASE_URL privately in that terminal, not in the
  local application's .env; use TLS and appropriately restricted database access.
- Preview: `node scripts/import-accounts.mjs --source <SNAPSHOT> --admin-email
  <EMAIL> --dry-run`. Only counts/fingerprints are printed, not credential hashes
  or business contents.
- Apply adds `--apply` instead of `--dry-run` and requires an interactive terminal
  with the exact confirmation `IMPORT ACCOUNTS`. The snapshot is rechecked before
  import. Target emptiness, all writes, verification and the new import audit event
  are enclosed in one transaction; errors roll back the transaction.
- Independently verify before opening the app with `--verify` instead of --apply.
  Existing passwords work on the hosted app; users must sign in again and create
  new capture keys. Pending accounts need fresh activation links from Admin.
- Extension grants and their ownership/activation timestamps are preserved by
  account migration. Pending extension code hashes and expiry dates are discarded
  at source projection; Admin must replace unused codes after cutover. Older
  snapshots without ExtensionAccess import with no grants, not implicit access.
- Tests use disposable SQLite databases with real Prisma and a mocked PostgreSQL
  lock check; they do not substitute for verification against the actual target.

## Hosting

- Recommended first host: Render Node Web Service with PostgreSQL. Build command:
  `npm ci --include=dev && npm run build:hosted`; start: `npm start` (uses PORT).
- Set Node 22, PostgreSQL DATABASE_URL, HTTPS APP_ORIGIN, and optionally the server
  AI key. Apply reviewed migrations as a separate authorized deployment step.
- Vercel can use `npm run build:hosted` with an external PostgreSQL database and the
  same environment contract. Do not use SQLite on ephemeral/serverless storage.
- No cloud resources, production accounts or real-data imports are created by
  a build/test command. The extension must be packaged for the final site origin.
- Current deployment: `https://capture-workbench.onrender.com`. `APP_ORIGIN` must
  match it exactly, because `/api/extension/download` packages the extension for
  that origin and a mismatch ships a package Chrome will not let reach the site.
- The source extension is built for that deployment: it is in `host_permissions`,
  in the popup CSP and in `WORKBENCH_ORIGINS`, so an unpackaged build offers a
  workbench that exists. Host access is still loopback plus exactly one workbench
  host, and a package replaces the default rather than adding to it. Change all
  three together, and never widen either list to a wildcard.
- A free instance sleeps when idle. The extension allows 60s for an HTTPS
  workbench (10s for loopback) and reads 502/503/504 as "not ready", so a
  cold start does not present as a dead server. Do not shorten that deadline.

## Layout

- `app/actions/*` - server actions
- `lib/` - authentication, workspace authorization, db client, follow-up rules,
  template rendering, and the fetch-free LinkedIn URL builder
- `components/` - client forms, clipboard controls and user-triggered search
- `scripts/` - explicit bootstrap/import/deployment and extension packaging tools

## Compliance gate before any release

Review LinkedIn references: allow clicked profile/search URLs, placeholders,
documentation, fixtures, and the extension's single-profile extraction. Never
fetch LinkedIn from the app or extension. Verify extension permissions remain
`activeTab`, `scripting`, `storage`, no content scripts/background, and host access
limited to loopback plus the packaged workbench host. Run unit and account-isolation
regressions, including foreign IDs, read-only admin views and revoked capture keys.
