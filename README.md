# Capture

A private workspace for a recruiter's pipeline: roles and their briefings, the people you talk to about them, outreach you send yourself, booked calls, screening notes and follow-ups. Everyone you talk to becomes a record you own.

Capture never contacts LinkedIn and never sends a message or an email on your behalf. It builds the link, writes the draft and remembers what happened; you click, paste and send. `AGENTS.md` is the full specification and the rules every change keeps.

## What it does

On every plan:

- **Roles** with an AI briefing from the job description, an optional budget, and the candidates for each, by stage.
- **People**: one record per person across every role, matched by LinkedIn member id or profile link, never by name. Do not contact, erasure with a warning if the same profile comes back, a yearly review list, and a full export.
- **Outreach** from your own templates, one person at a time, with a daily and weekly pace check. The optional Capture browser extension saves a LinkedIn profile on a click.
- **Booking page**: `{{booking_link}}` gives each candidate their own link to pick a time; the call lands on the role page and in Follow-ups.
- **Follow-ups**: replied, said yes but not booked, gone quiet, calls this week.

On Pro (decided per feature in `FEATURE_TIERS`, `lib/features.ts`):

- **Screening assistant**: a call transcript becomes four facts (salary, notice, location, right to work), each shown next to the line it came from, confirmed by you before anything is saved.
- **Client email** built from those facts, sent from your own inbox.
- **People search** across what people told you, with filters, **matches from your own database** for a new role, and **revisit reminders**.

## Running it locally

Node 22.14 or later.

```bash
npm ci
cp .env.example .env            # then fill it in; see below
npm run db:init:local -- --path /absolute/path/to/new/accounts.db
npm run dev                     # http://localhost:3000
```

Create the first administrator with `scripts/bootstrap-admin.mjs` (see "Setup and migration safety" in `AGENTS.md`); it writes a one-time sign-in link to a private file.

### Environment

| Variable | What for |
|---|---|
| `DATABASE_URL` | SQLite file locally, PostgreSQL when hosted |
| `APP_ORIGIN` | The exact origin the browser sees, including the port |
| `ANTHROPIC_API_KEY` | Briefings and screening summaries (server only) |
| `BOOKING_LINK_SECRET` | Signs booking links; 32+ random characters |
| `CAPTURE_SCREENING_MODEL`, `CAPTURE_SCREENING_EFFORT`, `CAPTURE_SCREENING_MONTHLY_CAP` | Optional screening settings |

### A demo workspace

To show every screen without real data, seed a fresh local database with three fictional roles and fifteen fictional candidates, one or two in each state:

```bash
npm run db:init:local -- --path /absolute/path/to/demo.db
DATABASE_URL=file:/absolute/path/to/demo.db node scripts/seed-demo.mjs --origin http://localhost:3000 --output /private/demo-link.txt
DATABASE_URL=file:/absolute/path/to/demo.db npm run dev
```

Open the link in `demo-link.txt` to set the demo account's password. The script works on local SQLite only and refuses to run twice on the same database.

## Tests

```bash
npm run test:unit   # rules, scripts and guards; no network
npm test            # unit tests, then the browser suite against a fresh test database and a local AI stub
npm run lint
npm run build
```

No test calls a paid model or a real service. The scripts that do (`make-synthetic-screenings.mjs`, `eval-screening.mjs`) print an estimate and refuse to start without `--approve-cost`.

## Hosting

Render (Node web service and PostgreSQL), built with `npm ci --include=dev && npm run build:hosted` and started with `npm start`. Database migrations are reviewed SQL under `prisma/postgresql/migrations`, applied as a separate, backed-up step, never by a build. The hosting log in `AGENTS.md` records each one.
