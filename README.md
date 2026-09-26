# Bridging Eden 2.0

Bridging Eden registers native-woodland projects in Ireland and issues carbon credits against them. This app is the registry: staff draft and approve issuances, holders see what they own, and anyone can retire a holding they actually have.

Credits are whole tonnes of CO₂e. They are not yield-bearing. There is no exchange, no payment flow, and no blockchain in this version.

## Run it locally

You need Node.js 20+ and PostgreSQL 16. Docker is the straightforward way to get Postgres:

```bash
cp .env.example .env
docker compose up -d
npm install
npm run setup
npm run dev
```

`npm run setup` applies migrations and loads the demo. The app is at http://localhost:3000.

If you already have Postgres, create a database and a user that can `CREATE EXTENSION btree_gist` (the migration needs it), put the URL in `DATABASE_URL`, and run the same `npm install` and `npm run setup`. Tests use a second database, `bridgingeden_test`, on the same server. `docker/init.sql` creates that database when the container is first initialised. On an existing server:

```bash
createdb -O bridgingeden bridgingeden_test
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run setup` | `prisma migrate deploy` and seed |
| `npm run db:reset` | Drop the app database, migrate, seed |
| `npm test` | Ledger unit tests and Postgres integration tests |
| `npm run build` | Production build |

Set `AUTH_SECRET` to a long random string before deploying. `AUTH_URL` should be the public origin.

### Demo accounts

Passwords are for the local demo. Change them before any shared deployment.

| Role | Email | Password |
| --- | --- | --- |
| Admin (Bridging Eden staff) | `admin@bridgingeden.ie` | `EdenAdmin!2026` |
| Holder | `aoife.brennan@example.com` | `HolderDemo!2026` |
| Holder | `liam.oconnell@example.com` | `HolderDemo!2026` |

The seed also creates two projects:

- **Glenmalure Native Woodland** (GLEN), vintage 2024, 500 t issued. Aoife holds serials 26–120 (95 t) after retiring 1–25 for Northwind Office Ltd. A 2026 draft of 180 t is waiting for approval.
- **Beara Atlantic Oakwoods** (BEARA), vintage 2025, 320 t issued. Liam holds serials 1–40. The rest is in the Bridging Eden inventory.

Open **Issuance** as the admin to approve the draft. Open **Portfolio** as Aoife to see the holding, the retirement, and the certificate.

Staff create further holder accounts from **Holdings**. There is no public registration.

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
- **No edits.** `UPDATE` and `DELETE` on events, postings, issued ranges, and the audit log raise an exception. `TRUNCATE` is still a database-owner operation; a production role should not have it.

Approval is the moment serials are chosen: the next number after the project's highest issued serial, under a per-project lock. Drafting and rejecting a batch write an audit row and nothing in the ledger.

`reconcile()` checks the derived invariant: for each project, tonnes held plus tonnes retired plus tonnes cancelled equals tonnes issued, and no serial sits in two holdings. The admin overview shows that check.

Tests in `tests/ranges.test.ts` cover range splits and derived balances without a database. `tests/ledger.integration.test.ts` runs against Postgres and covers overlap rejection, uncovered credits, unbalanced and empty events, append-only rows, partial transfers, round trips, retirement, cancellation, negative-balance refusal, and two concurrent transfers of the same holding.

## Issuance, in the product

1. An admin creates a project: name, location, methodology, standard or registry reference, description, and files.
2. The admin drafts a batch: vintage year, quantity in tonnes, methodology.
3. A second step approves it. The same person may approve in this version, and both identities and timestamps are stored. Requiring a different approver is a later policy on top of the same two states.
4. The admin transfers tonnes from inventory to a holder, by quantity or by an exact serial range.
5. The holder retires tonnes they hold, naming a beneficiary and a reason, and downloads a PDF certificate.

Cancellation is the staff path for tonnes that should leave circulation without a retirement certificate.

## Adding tokenisation later

The ledger stays the source of truth. A Solana mirror is a consumer of events, not a second balance.

Add a `token_mirror` table keyed by `ledger_events.id` (chain, signature, status). A worker reads events that have no mirror row and maps them:

- Issuance → mint, one unit per tonne, into the inventory wallet
- Transfer → token transfer between the wallets of the two accounts
- Retirement or cancellation → burn

Serial ranges travel as metadata. Reconciliation is one way: compare chain movements to the ledger and flag a mismatch. Do not derive a holding from the chain, and do not add yield. Nothing in `src/lib/ledger` needs to change for that module to exist.

## Deploying

The app is a standard Next.js deployment. On Vercel, set `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_URL`. Use a hosted Postgres that allows `btree_gist` (Neon, RDS, and current Supabase Postgres do). Run `prisma migrate deploy` as a release step, then `prisma db seed` only for a demo database.

Out of scope for this version: Solana, KYC providers, payments, live registry sync, and yield of any kind.
