# End-to-end suite

Replays the full recruiter-day walkthrough automatically, plus the error and
edge paths the walkthrough does not visit.

```bash
npm test
```

## What it does

- **Fresh database per run.** `global-setup.ts` deletes `prisma/test.db` and
  re-pushes the schema, so runs are repeatable and `prisma/dev.db` is never
  touched. The test server also builds into `.next-test/` so it does not fight
  a dev server you already have running.
- **No real Anthropic calls.** `anthropic-stub.mjs` serves a canned briefing on
  `localhost:8766`; the config points the SDK there with `ANTHROPIC_BASE_URL`.
  Tests are free, fast, and work offline. A role whose description contains
  `BADJSON` makes the stub reply with prose instead of JSON, which exercises the
  parse-failure and retry path.
- **No backdating by hand.** Where the manual walkthrough tells you to edit
  `lastActivityAt` in Prisma Studio, the suite writes the timestamp directly
  (`backdateCandidate` in `helpers.ts`).
- **LinkedIn is never contacted.** Every non-localhost request is intercepted
  and stubbed. `Run search` and `Open profile` are verified by capturing the
  popup and asserting its URL, never by loading it.

## Files

| File | Purpose |
| --- | --- |
| `01-walkthrough.spec.ts` | The walkthrough, in order: settings, role, briefing, search, candidates, outreach, follow-up buckets, home screen. |
| `02-edge-cases.spec.ts` | Error states, bad input, and the side effects of deleting or closing things. |
| `helpers.ts` | Shared Prisma client, `backdateCandidate`, and `note()`. |
| `anthropic-stub.mjs` | Local stand-in for the Anthropic API. |

Specs are numbered because Playwright orders files alphabetically and the
walkthrough seeds the data the edge cases reuse.

## Findings vs failures

A failed assertion means something is broken. Behavior that *works* but is
worse than it should be is recorded with `note()` instead: it prints as
`FINDING [id] ...` and appends to `tests/findings.log` without failing the run.
That keeps the suite green as a regression gate while still surfacing the rough
edges. When one of these is fixed, convert its `note()` into a plain assertion.
