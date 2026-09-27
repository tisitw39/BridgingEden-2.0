# Bridging Eden 2.0

Bridging Eden registers native-woodland projects in Ireland and issues carbon credits against them. This app is the registry: staff draft and approve issuances, holders see what they own, and anyone can retire a holding they actually have.

Credits are whole tonnes of CO₂e. They are not yield-bearing. There is no exchange, no payment flow, and no blockchain in this version.

## Run it locally

You need Node.js 20+ and PostgreSQL 16. Docker is the straightforward way to get Postgres:

```bash
cp .env.example .env
# Put a unique 32+ byte value in AUTH_SECRET. The example leaves it empty on purpose.
docker compose up -d
npm install
npm run setup
npm run dev
```

`npm run setup` applies migrations and loads the demo. The app is at http://localhost:3000. Postgres is published on `127.0.0.1:5432` only.

The app uses two database roles. `DATABASE_URL` is `bridgingeden_app`, which can insert ledger rows and cannot update, delete, or truncate them. `DIRECT_URL` is `bridgingeden_owner`, which Prisma Migrate uses. Neither role is a superuser. Docker's `POSTGRES_USER` is a bootstrap superuser used only to create the roles and the `btree_gist` extension. Do not put that user in `DATABASE_URL`.

On a Postgres that was created before these roles existed, run `docker/bootstrap-roles.sql` as a superuser against `postgres`, `bridgingeden`, and `bridgingeden_test`, then migrate. A fresh `docker compose` volume runs the same setup from `docker/init.sql`.

The seed refuses to run when `NODE_ENV=production`. Demo passwords are refreshed only by that seed. The login page shows them only when Node is not in production.

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run setup` | `prisma migrate deploy` and seed |
| `npm run db:reset` | Drop the app database, migrate, seed |
| `npm test` | Ledger, auth, and database-role tests |
| `npm run build` | Production build |

### Production environment

`AUTH_SECRET` must be a unique value of at least 32 bytes. The placeholder in older examples is rejected, and an empty value is rejected. `AUTH_URL` must be the public origin (`https://…`). The process refuses to serve production traffic without both. `trustHost` stays on so Auth.js can run behind a host header, and it is safe only because `AUTH_URL` is pinned.

In production the server also checks that `DATABASE_URL` is not a superuser.

### Demo accounts

Passwords are for the local demo. Change them before any shared deployment. A signed-in user can change their own password under Account.

| Role | Email | Password |
| --- | --- | --- |
| Admin (drafts issuances) | `admin@bridgingeden.ie` | `EdenAdmin!2026` |
| Admin (approves issuances) | `ciara.nolan@bridgingeden.ie` | `EdenAdmin!2026` |
| Holder | `aoife.brennan@example.com` | `HolderDemo!2026` |
| Holder | `liam.oconnell@example.com` | `HolderDemo!2026` |

The seed also creates two projects:

- **Glenmalure Native Woodland** (GLEN), vintage 2024, 500 t issued. Aoife holds serials 26–120 (95 t) after retiring 1–25 for Northwind Office Ltd. A 2026 draft of 180 t, drafted by the first admin, is waiting for Ciara to approve.
- **Beara Atlantic Oakwoods** (BEARA), vintage 2025, 320 t issued. Liam holds serials 1–40. The rest is in the Bridging Eden inventory.

Open **Issuance** as Ciara to approve the draft. The drafter sees that another admin must approve it. Open **Portfolio** as Aoife to see the holding, the retirement, and the certificate. The certificate links to a public `/verify/[eventId]` page.

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
- **No edits.** `UPDATE` and `DELETE` on events, postings, issued ranges, and the audit log raise an exception. `TRUNCATE` is revoked from the runtime role and a `BEFORE TRUNCATE` trigger rejects it for everyone, including the owner, until that trigger is disabled. The owner can disable triggers; the runtime role cannot. The owner is not a superuser, so it also cannot set `session_replication_role = replica`.
- **Immutable account identity.** `accounts.kind` and `accounts.code` cannot be updated. The runtime role may update an account's name and a user's password hash, and nothing else on those rows. `users.role` cannot be changed by the runtime role, and only the owner role can insert an admin.

Approval is the moment serials are chosen: the next number after the project's highest issued serial, under a per-project lock. The approver must be a different person from the drafter. The status update is conditional on the batch still being a draft, and reject takes the same per-project lock, so approve and reject cannot both commit. Drafting and rejecting a batch write an audit row and nothing in the ledger.

`reconcile()` checks the derived invariant: for each project, tonnes held plus tonnes retired plus tonnes cancelled equals tonnes issued, and no serial sits in two holdings. The admin overview shows that check.

Tests in `tests/ranges.test.ts` cover range splits and derived balances without a database. `tests/ledger.integration.test.ts` runs against Postgres and covers overlap rejection, uncovered credits, unbalanced and empty events, append-only rows, partial transfers, round trips, retirement, cancellation, negative-balance refusal, and two concurrent transfers of the same holding.

## Issuance, in the product

1. An admin creates a project: name, location, methodology, standard or registry reference, description, and files.
2. The admin drafts a batch: vintage year, quantity in tonnes, methodology.
3. A different admin approves it. Both identities and timestamps are stored. The same person cannot approve their own draft.
4. The admin transfers tonnes from inventory to a holder, by quantity or by an exact serial range.
5. The holder retires tonnes they hold, naming a beneficiary and a reason, and downloads a PDF certificate. The certificate includes a QR code and a public verification URL. That page shows the project, vintage, serials, quantity, beneficiary, date, and status.

Cancellation is the staff path for tonnes that should leave circulation without a retirement certificate.

## Adding tokenisation later

The ledger stays the source of truth. A Solana mirror is a consumer of events, not a second balance.

Add a `token_mirror` table keyed by `ledger_events.id` (chain, signature, status). A worker reads events that have no mirror row and maps them:

- Issuance → mint, one unit per tonne, into the inventory wallet
- Transfer → token transfer between the wallets of the two accounts
- Retirement or cancellation → burn

Serial ranges travel as metadata. Reconciliation is one way: compare chain movements to the ledger and flag a mismatch. Do not derive a holding from the chain, and do not add yield. Nothing in `src/lib/ledger` needs to change for that module to exist.

## Deploying

The app is a standard Next.js deployment. On Vercel, set `DATABASE_URL` to the runtime role, `DIRECT_URL` to the migration role, `AUTH_SECRET` (at least 32 bytes, not a placeholder), and `AUTH_URL` to the public origin. Use a hosted Postgres that allows `btree_gist` (Neon, RDS, and current Supabase Postgres do). Create `bridgingeden_owner` and `bridgingeden_app` with passwords that are not the local defaults, grant them as `docker/bootstrap-roles.sql` does, and run `prisma migrate deploy` as `bridgingeden_owner`. Do not run the seed against production.

Supporting documents are stored in Postgres and limited to two files of 1.5 MB so a server action stays under the platform body limit of about 4.5 MB. Larger project files would need direct-to-storage uploads. That path is not in this version.

Sessions last eight hours. Admin pages and actions load the user's role from the database on each request, so a demotion applies before the token expires. Failed logins are rate limited and written to the audit log.

Auth.js in this version is `next-auth` 5 beta. That is a known dependency risk until a stable release is adopted.

`npm audit` still reports 7 issues, all build-time or test-time, and each advertised fix is a major upgrade or a downgrade. They are left as-is: Next.js 15 bundles a PostCSS with source-map advisories (the fix npm offers is Next.js 16), Prisma's CLI config pulls `deepmerge-ts` (the offered fix is a downgrade), and Vitest's mocker has a path-traversal advisory fixed only in Vitest 5. None of these are on the request path that posts the ledger.

Out of scope for this version: Solana, KYC providers, payments, live registry sync, and yield of any kind.
