# Bridging Eden 2.0

Bridging Eden registers native-woodland projects in Ireland and issues carbon credits against them. This app is the registry: staff draft and approve issuances, holders see what they own, and anyone can retire a holding they actually have.

Credits are whole tonnes of CO₂e. They are not yield-bearing. There is no exchange, no payment flow, and no blockchain in this version.

## Run it locally

You need Node.js 22 (see `.nvmrc`) and PostgreSQL 16. Docker is the straightforward way to get Postgres:

```bash
cp .env.example .env
# Put a unique 32+ byte value in AUTH_SECRET. The example leaves it empty on purpose.
docker compose up -d
npm install
npm run setup
npm run dev
```

`npm run setup` applies migrations and loads the demo. The app is at http://localhost:3000. Postgres is published on `127.0.0.1:5432` only.

The app uses two database roles. `DATABASE_URL` is `bridgingeden_app`, the only login the running app is allowed to use. It can insert ledger rows. It cannot update or delete them, and it cannot truncate them. On `credit_batches` it can update only the status, serial, and approval or rejection columns. `DIRECT_URL` is `bridgingeden_owner`. Prisma Migrate uses it, and the test suite uses it to reset rows. The owner is not a runtime credential: it can disable triggers, including the truncate guards. Neither role is a superuser. After bootstrap the owner also has neither `CREATEDB` nor `CREATEROLE`. Docker's `POSTGRES_USER` is a bootstrap superuser used only to create the roles and the `btree_gist` extension. Do not put that user, or the owner, in `DATABASE_URL`.

Set `BRIDGINGEDEN_OWNER_PASSWORD` and `BRIDGINGEDEN_APP_PASSWORD` before the first `docker compose up`. `docker/init.sh` reads them and refuses a password that equals the role name. On a Postgres that was created before these roles existed, run `docker/bootstrap-roles.sql` as a superuser with `-v owner_password=... -v app_password=...`. That file does not create the databases, and the first run removes `CREATEDB` from the owner, so the superuser has to create them in between:

```bash
psql "postgresql://SUPERUSER@127.0.0.1:5432/postgres" \
  -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
  -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
  -f docker/bootstrap-roles.sql
psql "postgresql://SUPERUSER@127.0.0.1:5432/postgres" <<'SQL'
CREATE DATABASE bridgingeden OWNER bridgingeden_owner;
CREATE DATABASE bridgingeden_test OWNER bridgingeden_owner;
SQL
psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden" \
  -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
  -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
  -f docker/bootstrap-roles.sql
psql "postgresql://SUPERUSER@127.0.0.1:5432/bridgingeden_test" \
  -v owner_password="$BRIDGINGEDEN_OWNER_PASSWORD" \
  -v app_password="$BRIDGINGEDEN_APP_PASSWORD" \
  -f docker/bootstrap-roles.sql
npx prisma migrate deploy
```

`scripts/ci-bootstrap.sh` does the same steps with generated passwords. On GitHub Actions it registers each role password, `AUTH_SECRET`, and `AUDIT_EMAIL_HMAC_KEY` with `::add-mask::` before writing them to `GITHUB_ENV`, so those values are redacted in the run log. Locally it writes them to `/tmp/ci-database.env` and does not print them. Do not put those passwords in the SQL file.

The seed runs only when `ALLOW_DEMO_SEED=1`, `NODE_ENV` is not `production`, and the `users` table is empty. `.env.example` does not set the flag. `npm run setup` and `npm run db:seed` set it in a child process, which works in Windows cmd as well as a Unix shell. The login page shows the demo passwords only when Node is not in production.

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run setup` | `prisma migrate deploy` and seed |
| `npm run db:reset` | Drop the app database, migrate, seed |
| `npm test` | Ledger, auth, and database-role tests. Requires `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, and `AUDIT_EMAIL_HMAC_KEY` |
| `npm run build` | Production build |

### Production environment

`AUTH_SECRET` must be a unique value of at least 32 bytes. The placeholder in older examples is rejected, and an empty value is rejected. `AUTH_URL` must be an absolute `https` URL. `http` is rejected in production. The process refuses to serve production traffic without both. `trustHost` stays on so Auth.js can run behind a host header, and it is safe only because `AUTH_URL` is pinned.

In production the server also refuses to start when `DATABASE_URL` is a superuser, a member of `bridgingeden_owner`, or a role that owns the ledger tables (`ledger_events`, `ledger_postings`, `issued_serial_ranges`, `audit_logs`, `credit_batches`, and `retirement_verifications`), and when any integrity trigger is not enabled (`pg_trigger.tgenabled` must be `O`). That list covers the balance, coverage, issuance, freeze, draft-only, contra-debit, role-guard, account-immutability, append-only, and truncate triggers, including `retirement_verifications_no_truncate`. The hourly cron runs the same trigger check before it sweeps. It also refuses to start without `AUDIT_EMAIL_HMAC_KEY`, a unique value of at least 32 bytes. When `VERCEL` is set it also refuses to start unless `CRON_SECRET` is at least 32 bytes. Unknown-email login audits store an HMAC of the address, not an unsalted hash and not the address. The running app therefore cannot be given `DIRECT_URL`. If `DATABASE_URL` has no `connection_limit`, production adds `connection_limit=1` and other environments add `connection_limit=5`, so one serverless instance cannot open a large pool of its own. `pgcrypto` is not installed; tokens and password hashes are produced in the application.

Tests do not embed role passwords. Export `TEST_DATABASE_URL` (the app role, database `bridgingeden_test`) and `TEST_DIRECT_URL` (the owner role, same database) before `npm test`. The suite exits immediately if either is missing. Also export `AUDIT_EMAIL_HMAC_KEY` (at least 32 bytes).

### Demo accounts

Passwords are for the local demo. Change them before any shared deployment. A signed-in user can change their own password under Account.

| Role | Email | Password |
| --- | --- | --- |
| Admin (drafts issuances) | `admin@example.com` | `EdenAdmin!2026` |
| Admin (approves issuances) | `ciara.nolan@example.com` | `EdenAdmin!2026` |
| Holder | `aoife.brennan@example.com` | `HolderDemo!2026` |
| Holder | `liam.oconnell@example.com` | `HolderDemo!2026` |

The seed also creates two projects:

- **Glenmalure Native Woodland** (GLEN), vintage 2024, 500 t issued. Aoife holds serials 26–120 (95 t) after retiring 1–25 for Northwind Office Ltd. A 2026 draft of 180 t, drafted by the first admin, is waiting for Ciara to approve.
- **Beara Atlantic Oakwoods** (BEARA), vintage 2025, 320 t issued. Liam holds serials 1–40. The rest is in the Bridging Eden inventory.

Open **Issuance** as Ciara to approve the draft. The drafter sees that another admin must approve it. The database also rejects an approval where `approved_by_id` equals `drafted_by_id`. Open **Portfolio** as Aoife to see the holding, the retirement, and the certificate. The certificate links to a public `/verify/[token]` page. The token is 128 random bits in `retirement_verifications`, separate from the event id. A retirement does not update the journal row.

Staff create further holder accounts from **Holdings**. There is no public registration. Creating an admin in the database is an owner-role operation; the runtime role cannot insert or change an admin.

## Architecture

Next.js (App Router) and TypeScript. Tailwind uses the Bridging Eden tokens from the public site: cream `#FCFAF3`, forest `#1C5F21`, sage header `#A5D6A7`, DM Serif Display, Inter, and tracked monospace labels. Prisma talks to PostgreSQL. Auth is Auth.js with email and password, a JWT session, and two roles: `ADMIN` and `HOLDER`.

```
Browser
  └─ Server actions / route handlers
       └─ src/lib/ledger   ← the only writer of financial facts
            └─ PostgreSQL
                 ledger_events + ledger_postings   (source of truth)
                 issued_serial_ranges              (overlap constraint, trigger-filled)
                 triggers                          (coverage, balance, append-only)
```

Supporting documents live in Postgres (`bytea`) so the app can run on Vercel with a hosted database and no separate file store. Project pages are public. Admin routes require an admin session.

### Accounts

| Code | Kind | Role in an entry |
| --- | --- | --- |
| `ISSUANCE` | Contra | Credited when tonnes are created. This is not a holding. |
| `INVENTORY` | Asset | Bridging Eden's own holding, where new tonnes land. |
| `HOLDER:…` | Asset | One per holder. |
| `RETIREMENT` | Sink | Debited when a holder retires tonnes. |
| `CANCELLATION` | Sink | Debited when staff cancel tonnes. |

## How the ledger works

The ledger is an append-only journal in double-entry form. A balance is never a column you can edit. Holdings are computed by replaying postings: a debit adds one to every serial in a range, a credit subtracts one. A serial's count is 0 or 1. Anything else is treated as a broken ledger.

Each business action is one `ledger_events` row and a matched set of `ledger_postings`:

| Event | Debit (receives the range) | Credit (gives up the range) |
| --- | --- | --- |
| Issuance | Inventory | Issuance contra |
| Transfer | Destination holder or inventory | Source holding |
| Retirement | Retirement sink | Holder |
| Cancellation | Cancellation sink | Holding being cancelled |

Both sides of an event carry the same serial ranges. A transfer of 25 tonnes out of 1–100 posts 1–25 and leaves 26–100. An explicit slice, such as 40–60, splits the middle and leaves two ranges. Giving the same serials back to a previous holder is a normal transfer: the count goes to zero and then to one again.

Serials are integers, unique per project, and start at 1. Vintage is an attribute of the batch, not a second serial space. Project A and project B can both have serial 1.

### What the database enforces

The migration, not only the application, refuses bad rows:

- **No overlapping issuance.** A trigger copies each contra credit into `issued_serial_ranges`. A GiST exclusion constraint rejects any overlapping range for the same project. That table is an enforcement index filled by the trigger. It is not a balance.
- **No spend of tonnes you do not hold.** Before a credit is inserted on an asset or sink account, a trigger sweeps existing debits and credits and requires every serial in the new range to have a count of at least 1. An advisory lock serialises concurrent credits on the same account, project, and vintage.
- **No unbalanced event.** A deferred constraint checks that debit ranges and credit ranges are the same multiset, with no internal overlap.
- **No empty event.** An event without postings cannot commit.
- **No edits.** `UPDATE` and `DELETE` on events, postings, issued ranges, and the audit log raise an exception. `TRUNCATE` is revoked from the runtime role and a `BEFORE TRUNCATE` trigger rejects it for everyone, including the owner, until that trigger is disabled. The owner can disable triggers; the runtime role cannot. That is why the owner URL stays out of the running app. The owner is not a superuser, so it also cannot set `session_replication_role = replica`.
- **Immutable account identity.** `accounts.kind` and `accounts.code` cannot be updated. The runtime role may update an account's name, a user's password hash, and that user's token version, and nothing else on those rows. `users.role` cannot be changed by the runtime role, and only the owner role can insert an admin.
- **Issuance is a batch.** A new `credit_batches` row can only be inserted as `DRAFT`, with the approval, rejection, and serial columns null. A deferred check rejects an `APPROVED` row unless the same transaction contains its `ISSUANCE` event. That event's actor must be the batch's approver. The approver and the drafter must both be admins. The check takes `FOR SHARE` on those two `users` rows. The contra credits must match the batch quantity and serial range. A contra credit on any other event type is rejected. A debit to a contra account is rejected unless the event is an issuance.
- **Four eyes, in the database.** `credit_batches` has `CHECK (approved_by_id IS NULL OR approved_by_id <> drafted_by_id)`. A `BEFORE UPDATE` trigger freezes a batch that is no longer `DRAFT`, including for the table owner. The runtime role's `UPDATE` grant on that table is column-level: status, serial start, serial end, and the approval and rejection columns. Transfers and cancellations are not four-eyes. The database cannot enforce four-eyes against a compromised application role: that shared login can write any two admin ids in one transaction. Binding an approval to a person would need signed approvals or a database identity per user.

Approval is the moment serials are chosen: the next number after the project's highest issued serial, under a per-project lock. The approver must be a different person from the drafter, in the service and in the check constraint. The status update is conditional on the batch still being a draft, and reject takes the same per-project lock, so approve and reject cannot both commit. Drafting and rejecting a batch write an audit row and nothing in the ledger.

`reconcile()` checks the derived invariant: for each project, tonnes held plus tonnes retired plus tonnes cancelled equals tonnes issued, and no serial sits in two holdings. The admin overview shows that check.

Tests in `tests/ranges.test.ts` cover range splits and derived balances without a database. `tests/ledger.integration.test.ts` runs against Postgres and covers overlap rejection, uncovered credits, unbalanced and empty events, append-only rows, partial transfers, round trips, retirement, cancellation, negative-balance refusal, and two concurrent transfers of the same holding.

## Issuance, in the product

1. An admin creates a project: name, location, methodology, standard or registry reference, description, and files.
2. An admin drafts a batch: vintage year, quantity in tonnes, methodology. The database rejects the issuance if the drafter is not an admin.
3. A different admin approves it. Both identities and timestamps are stored. The same person cannot approve their own draft.
4. The admin transfers tonnes from inventory to a holder, by quantity or by an exact serial range.
5. The holder retires tonnes they hold, naming a beneficiary and a reason, and downloads a PDF certificate. The certificate includes a QR code and a public verification URL. The URL carries a 128-bit token, not the event id. That page shows the project, vintage, serials, quantity, beneficiary, date, and status, and it is rate limited. A busy verification lock shows its own message. It does not say the network has made too many attempts.

Cancellation is the staff path for tonnes that should leave circulation without a retirement certificate.

## Adding tokenisation later

The ledger stays the source of truth. A Solana mirror is a consumer of events, not a second balance.

Add a `token_mirror` table keyed by `ledger_events.id` (chain, signature, status). A worker reads events that have no mirror row and maps them:

- Issuance → mint, one unit per tonne, into the inventory wallet
- Transfer → token transfer between the wallets of the two accounts
- Retirement or cancellation → burn

Serial ranges travel as metadata. Reconciliation is one way: compare chain movements to the ledger and flag a mismatch. Do not derive a holding from the chain, and do not add yield. Nothing in `src/lib/ledger` needs to change for that module to exist.

## Deploying

The app is a standard Next.js deployment. The running app, including Vercel, gets `DATABASE_URL` for `bridgingeden_app` and nothing else for the database. Point `DATABASE_URL` at a pooled host, for example the Neon pooler or the Supabase pooler (port 6543), and add `pgbouncer=true` plus a small `connection_limit` (1 is enough behind a pooler). Do not set `DIRECT_URL` there. Prisma Client queries do not need it. Migrations run from CI or a release job that has `DIRECT_URL` for `bridgingeden_owner` on the direct (non-pooled) host and runs `prisma migrate deploy`. The Next.js build does not migrate. Create both roles with `docker/bootstrap-roles.sql`, passing real passwords in `-v owner_password` and `-v app_password`. Use a hosted Postgres that allows `btree_gist` (Neon, RDS, and current Supabase Postgres do). Do not run the seed against production.

Also set `AUTH_SECRET` (at least 32 bytes, not a placeholder), `AUDIT_EMAIL_HMAC_KEY` (at least 32 bytes), and `AUTH_URL` to the public `https` origin. Production startup rejects `http`. Sessions last eight hours and carry a token version. Changing a password increments that version, and signing out does too. Logout signs out every device that still holds the previous session. Setting or changing a password is refused when it matches a bundled list of about 100,000 common passwords (the xato top-100000 list). There is no call to an external breach service. Admin passwords must be at least 12 characters. Holder passwords must be at least 8. Failed logins back off on the pair of email and IP. After 12 failures for that email, further attempts from every IP are limited. One address's failures do not lock the account out from a different IP before that ceiling. A limited attempt still runs the password compare, so a missing account and a backed-off account take the same path. Each rate-limited window writes one aggregated audit row, not one row per attempt. A failed login for an unknown address writes at most one audit row per IP per window, storing an HMAC of the address after it has been cut to 254 characters, not the address itself. Advisory locks on login and verification are non-blocking. A busy verification lock is reported separately from the attempt ceiling. Login transactions wait at most 5 seconds for a pooled connection (`LOGIN_POOL_MAX_WAIT_MS` can lower that to 2 seconds). A pool timeout is treated as rate limited, so the request does not become a 500. Middleware also counts `POST /login`, `POST /api/auth/callback/*`, `POST /api/auth/signin/*`, and `/verify` per IP inside the instance (10 login posts and 30 verification requests per minute). That counter is not shared across Vercel isolates. The limit that holds across isolates is a Vercel Firewall rate-limit rule, which is a project setting rather than something this repo can enforce: one rule for `POST` on `/login` and `/api/auth/callback/*`, and one for `/verify`, each keyed by IP.

Expired throttle rows are removed by `npm run db:sweep`. The server does not run that sweep on a timer. On Vercel, configure a Vercel Cron for `GET /api/cron/sweep` (see `vercel.json`, hourly). An hourly cron may need a paid Vercel plan. Hobby can limit cron jobs to once a day. Set `CRON_SECRET` to at least 32 bytes. When `VERCEL` is set, startup refuses a shorter value. Vercel sends `Authorization: Bearer $CRON_SECRET`. The route hashes both sides with SHA-256 and compares the digests with `timingSafeEqual`. It also refuses to sweep while any integrity trigger is disabled. A long-running host can cron `npm run db:sweep` instead. Do not rely on an in-process timer: serverless instances do not stay warm.

Supporting documents are stored in Postgres and limited to two files of 1.5 MB so a server action stays under the platform body limit of about 4.5 MB. Larger project files would need direct-to-storage uploads. That path is not in this version.

Admin pages and actions load the user's role and token version from the database on each request, so a demotion or a password change applies before the token expires. Script CSP uses a per-request nonce. Style attributes still need `'unsafe-inline'` because a nonce does not cover them.

Auth.js in this version is `next-auth` 5 beta. That is a known dependency risk until a stable release is adopted.

`npm audit` still reports issues whose advertised fixes are a major upgrade or a downgrade. They are left as-is: Next.js 15 bundles a PostCSS with source-map advisories (the fix npm offers is Next.js 16), Prisma's CLI config pulls `deepmerge-ts` (the offered fix is a downgrade), and Vitest's mocker has a path-traversal advisory fixed only in Vitest 5. None of these are on the request path that posts the ledger.

## Known limitations

- Transfers and cancellations are not four-eyes. One admin can move or cancel tonnes. Issuance approval is the step that requires a second admin. Four-eyes on issuance does not hold if the application role itself is compromised.
- There is no trusted-device cookie, CAPTCHA, or alerting on failed logins. Backoff slows guessing. It does not notify staff.
- The major-version `npm audit` upgrades above are not applied in this version.

## Before production

- Generate strong passwords for `bridgingeden_owner` and `bridgingeden_app`. Refuse any password equal to the role name.
- On Vercel, set only `DATABASE_URL`, `AUTH_SECRET`, `AUDIT_EMAIL_HMAC_KEY`, `AUTH_URL`, and `CRON_SECRET`. `DATABASE_URL` is the pooled app-role URL (`pgbouncer=true`, small `connection_limit`). Do not set `DIRECT_URL`.
- Add Vercel Firewall rate-limit rules for `POST /login` and `/verify`. The middleware counter does not span isolates.
- Keep the owner credentials in a secrets manager, and alert on `DISABLE TRIGGER`.
- Add CAPTCHA and alerting on failed logins.
- Require TOTP for admin accounts.
- Decide whether transfers and cancellations should be four-eyes as well.
- Move off `next-auth` 5 beta onto a stable release, and take the Next.js 16 upgrade.
- Configure backups and point-in-time recovery.
- Run a penetration test against staging.

Out of scope for this version: Solana, KYC providers, payments, live registry sync, and yield of any kind.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It checks out with pinned action SHAs, uses Node 22, and grants the workflow only `contents: read`. The job starts Postgres 16, bootstraps the roles and both databases with `scripts/ci-bootstrap.sh`, applies migrations, then runs lint, typecheck, the full test suite, and the production build:

```bash
bash scripts/ci-bootstrap.sh
npx prisma migrate deploy
npm run lint
npm run typecheck
npm test
npm run build
```
