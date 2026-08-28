# Recruiter Workbench

A private workspace for a recruiter's pipeline. It never contacts LinkedIn. The only
LinkedIn interaction is building a `linkedin.com` URL string and opening it in a new tab
when the recruiter clicks. See the design document's Part 1 compliance rules: no LinkedIn
API, no scraping, no extensions, no automated messaging, no reading LinkedIn state.

## Commands

- Dev server: `npm run dev` (http://localhost:3000)
- Build + typecheck: `npm run build`
- Lint: `npm run lint`
- DB migration after schema change: `npx prisma migrate dev --name <name>`

## Setup

- Copy `.env.example` to `.env`. `ANTHROPIC_API_KEY` is needed only for briefing
  generation; everything else works without it.
- `npx prisma migrate dev` creates the SQLite database. The Settings row is created
  lazily on first read (`lib/settings.ts`), no seed step needed.
- Prisma is pinned to v6 (v7 requires a different config format than this schema uses).

## Layout

- `app/actions/*` - server actions (all mutations)
- `lib/` - db client, stage list, follow-up bucket rules, template rendering,
  the LinkedIn URL builder (`lib/linkedin.ts`, keep it fetch-free)
- `components/` - client components (clipboard, run search, confirm buttons)

## Compliance gate before any release

Grep for `linkedin.com`: every hit must be a URL opened in a new tab on a user click
(or placeholder text), never inside a fetch or server code.
