# Capture

A private workspace for a recruiter's pipeline. The main application never contacts
LinkedIn: it only builds a profile or search URL and opens it on a user click.
The optional Capture extension uses a toolbar click for one active-tab
profile read via `activeTab` and `scripting`. It may also live in Chrome's side
panel (`sidePanel`), which changes where the same page sits, not what it may
read. LinkedIn is declared as an OPTIONAL origin only: it is not granted at
install, the recruiter grants it from a button in the panel so the panel can
fill itself in as they move from profile to profile, and Chrome lets them take
it back. There are still no registered content scripts, no background page, no
request of any kind to LinkedIn, no writing to its pages, no bulk capture,
polling, crawling or automated messaging. The reader is injected on demand and
only while the panel is open; fields remain editable, notes are written only by
the user, and saving requires a user click. This click-triggered exception
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
- Typecheck without a build: `npx tsc --noEmit`. Run it after, not concurrently
  with, a build: Next regenerates included `.next-build/types` files during build.
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
  The product is being renamed Retrivr. The public homepage (anonymous `/` and
  `/welcome`), the sign-in page, the public header and the whole signed-in
  workspace already carry the Retrivr name and logo (`public/brand/`), the tab
  title included, and so do the candidate's booking page and the client's
  shortlist page (their bare header, the default privacy notice and the
  `.ics` PRODID). The extension (still named Capture in Chrome, so workspace
  copy calls it "the extension" where it says where to find it), its API's
  messages and these docs are renamed separately. Code identifiers, cookie
  and header names, environment variables and routes keep "capture".
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
  state. There are two public business routes, each opened by a signed link
  and nothing else: `/book/[token]` and its `.ics`, a candidate's booking page
  (see Booking page), and `/s/[token]`, a client's shortlist (see Client
  links). The ways in - `/login`, `/signup`, `/signup/verify`,
  `/forgot-password`, `/activate` - are public too (see Self-serve sign-up),
  and so are `/terms` and `/privacy`, which use the public header signed in or
  not. Their text describes what the software does; change it, and
  `LEGAL_VERSION` in `lib/legal.ts`, when the product changes. Who runs
  Retrivr (`OPERATOR`: Basanite is not incorporated yet, so the contract is
  with its runner, trading as Basanite) lives there too; until the name,
  address and contact email are filled in both pages say they are a draft and
  `signupConfig()` will not open sign-up on them.
  All other business routes still require authentication.
- `ApplicationShell` selects public navigation or the responsive workspace sidebar;
  on the homepage it renders only the skip link, because `MarketingHome` brings
  its own Retrivr header and footer. `MarketingHome` is a port of the reviewed
  `demo/landing` page: its styles are `app/landing.css`, every class `lp-`
  prefixed so neither side reaches the other, and its moving parts are small
  client components in `components/landing/` (`HeroBoard`, `LandingMotion`,
  `Pricing`, `ContactBox`). Each animated figure rests on its last frame and
  plays only on arrival or Replay; reduced motion shows still frames with no
  Pause or Replay. Pricing, the trial and the contact address are marketing
  copy, not entitlements: `FEATURE_TIERS` still decides what an account can
  use, and it follows the homepage's table (see Account classification). The
  price numbers live in `lib/plan-prices.ts`, shared with `/billing`. Once
  sign-up is open (`signupConfig().open`), "Try Pro free" and the Lite, Basic
  and Pro buttons go to `/signup`; Pro Max, and every button before sign-up
  opens, goes to the contact box. The page uses explicitly illustrative,
  static data only. Never feed real recruiting data into a public preview or
  invent customer claims.
- Dashboard search/sort in `RoleDirectory` works only on server-authorized records
  and does not write data. The four summary cards above it are links to what
  they count: the role list below (`#role-directory`), People, Follow-ups and
  Searches. Keep all mutation labels, owner checks and read-only
  protections intact when restyling pages.
- `tests/06-design.spec.ts` covers public/private routing, mobile overflow, keyboard
  navigation, the homepage header, hero controls, FAQ and pricing toggle,
  password visibility and role filtering. Screenshots use
  test-only fixtures in ignored test-results; no real user data is captured.
- Role briefings use six independent, initially collapsed native details sections.
  First-call questions request and save only `{ question }`; legacy answer fields
  are not displayed. `tests/01-walkthrough.spec.ts` covers toggling, keyboard/mobile
  use and legacy compatibility; the AI stub checks the questions-only prompt and
  deliberately returns extra answer fields to verify they are discarded.
- A role page reads as three headings of equal weight - Briefing, Candidates,
  Searches for this role. Candidates is a plain heading carrying its count;
  the stage groups inside it are what open and close, so a long pipeline can be
  folded down without the section itself becoming a thing to unfold. With
  talent matches, "From your database" is one more collapsed group at the end
  of Candidates, not a fourth heading. Adding a
  candidate is a button at the top of that section that opens the fields, the
  same shape as a new role or a new template. It stays rendered in a read-only
  view and is disabled by the page's fieldset, so what cannot be done reads as
  refused rather than missing.
- `/templates` is a library, not a workbench: each saved template is a collapsed
  `details` showing only its name and kind, opened to read, edit or delete it,
  and writing a new one lives on `/templates/new` behind a New template button,
  the way a role or a search does. The list of gaps this app can fill belongs on
  that form, next to the box being typed into, not above the library.
- Outbound message text passes through `normalizeMessage` in `lib/render.ts`:
  one kind of line ending, no trailing spaces, at most one blank line between
  paragraphs, nothing before the first word or after the last. Single newlines,
  indentation and runs of spaces inside a line survive, so lists stay lists and
  alignment stays aligned. It also removes what a paste drags in and nobody
  typed - zero-width characters and byte-order marks, Unicode spaces including
  the non-breaking one, and U+2028/2029 line separators - because a line
  holding one non-breaking space reads as blank, is not blank, and so escapes
  the blank-line rule. That is the gap that kept coming back.
  It runs on the rendered message, on a template as it is saved, on the body
  recorded by `markAsSent`, and on text as it is pasted into the template
  editor and the outreach draft, so the box shows what will be sent rather than
  what the clipboard held. `MessageBodyField` counts the normalised text, so
  the counter, the connection-note limit and what is stored agree. Route new
  outbound text through it rather than tidying whitespace at the point of
  copying. `tests/03-render.spec.ts` covers it as a pure function alongside the
  article rule; `E12b` covers a real paste end to end.

- A saved search may carry `SavedSearch.searchUrl`: an address the recruiter
  copied out of LinkedIn or Recruiter after building and saving the search
  there. Industries and Recruiter's filters cannot be expressed in an address
  this app composes, so that one is reopened as given. `lib/linkedin.ts` only
  validates it (HTTPS, a linkedin.com host including country subdomains, a
  path under `/talent/` or `/search/`) and never parses, rewrites, keeps in
  step with a filter table, or requests it. A refused address is reported, not
  dropped. With a link present the filter chips stay visible but stop claiming
  to be a re-tick checklist; without one, Run search still builds the keyword
  people-search URL as before.

- `/roles/[id]/outreach` is the guided outreach queue: one shortlist, one
  template, one candidate on screen, with `?c=` ids and `?i=` index in the
  address. It removes navigation only. It must never send, paste into another
  site, open anything on its own, advance without a click, or offer an
  "open all"/"send all"/auto-advance control: that is what makes a recruiter's
  own LinkedIn account look automated, and the restriction lands on them.
  `tests/10-outreach-queue.spec.ts` asserts the absence of those controls, so
  adding one fails the suite rather than shipping quietly.
- Queue ids are scoped server-side to the role and the owner before anything is
  rendered; unknown or foreign ids are dropped rather than reported. Both the
  single-candidate page and the queue record through one `recordSend` helper in
  `app/actions/outreach.ts`, so "contacted", the nudge counters and the log
  cannot differ by route. `markSentAndAdvance` only redirects to a path matching
  this app's own queue route.
- The same text marked as sent to the same candidate on the same UTC day is one
  message: `recordSend` records nothing for the repeat and does not count it as
  another nudge. The person page, the candidate's past outreach and the pace
  counts read through `oncePerDay` (`lib/outreach-log.ts`), so repeats logged
  before this rule also count once. Rows are never deleted for it.
- `components/OutreachStep.tsx` holds the one message on screen. It is editable,
  so personalising someone's line does not mean a trip into LinkedIn and back,
  and what is copied is what `markSentAndAdvance` records. The length count and
  the gap check run against the edited text, not the rendered template.
- That draft is client state, so the queue keys `OutreachStep` by candidate and
  template. Without the key React reuses the instance across a move and the last
  person's message sits under the next person's name - and is recorded as
  theirs. Keep the key if the component moves or is wrapped.
- The queue moves both ways. Going back is an arrow at the corner of the card,
  labelled with the person it returns to, because that is where the card came
  from; the candidate's own name is the link to their page, so neither needs a
  button among the actions. The address is the whole state, so a reload or a
  shared link resumes in the same place.
- One control does the two things that always happened together: the message
  goes to the clipboard and LinkedIn opens. Where it opens is the only
  difference. `Candidate.memberId` holds LinkedIn's own member id, read from the
  profile's Message link by the extension on the click that saved the candidate;
  with it, `messageComposeUrl` in `lib/linkedin.ts` opens LinkedIn's message box
  itself, and without it the profile opens and the Message button is the
  recruiter's to find. The address carries a recipient and nothing else -
  LinkedIn has no parameter for a message body.
- Pasting stays with the recruiter on purpose. Writing the draft into LinkedIn's
  own box would need a user gesture per page under `activeTab`, so the cheapest
  version of it costs the same one keystroke as Ctrl+V; the only way around that
  is a standing LinkedIn host permission and a content script, which is exactly
  what makes an extension look like an automation tool. Do not trade the
  compliance line for a keystroke.
- `Candidate.memberId` is additive and nullable, applied as
  `20260922000000_candidate_member_id`. Candidates added by hand have none, and
  every path must keep working without it.
- `lib/pace.ts` counts what has been logged today and the invitations logged in
  the last seven days, and says so on every screen of a run, with a stronger
  line as the weekly invitation count climbs. It is advisory and never blocks a
  send: the real limit is LinkedIn's, unpublished and per account. Keep the
  counting honest and the thresholds conservative rather than precise.

## Follow-up run

- `/followups/run` (`followUpRuns`, every plan) is the outreach queue for
  everyone due a follow-up, across roles, under the same rules: it never
  sends, opens LinkedIn by itself, advances without a click, or offers a
  control that acts on more than the person on screen. "Mark as sent" records
  and moves to the next person; the arrow at the corner goes back.
- The list comes from the follow-up buckets through `planRun`
  (`lib/followup-run.mjs`): replied first, then client-wants-to-meet, then
  said-yes-not-booked, then went quiet, longest wait first, each with a
  reason. Do not contact and
  anyone already written to today cannot be ticked; nudged twice starts
  unticked with a suggestion to mark them rejected. It is advisory, not a cap:
  there is no pace limit on a run. Entry points are "Follow up in batches" and
  "Go through these one by one" on Follow-ups (`?only=r|m|b|q`).
- The address is the whole run: `c=<group>.<candidateId>` in order,
  `tm`/`tb`/`tq` the template per group, `i` the position. Ids are scoped to
  the owner before anything renders; foreign, unknown and do-not-contact ids
  are dropped, and a run with nobody left goes back to the list. Client-wants-
  to-meet, said-yes and quiet use the chosen template or Capture's built-in
  follow-up (`BUILT_IN_TEMPLATES`), which asks for times instead of a link
  when booking is not set up, and for client interviews until those can be
  booked. A template change on the list re-reads the page with `review=1`,
  ticks kept.
- Without a message, a person can be settled from the card - they replied,
  said yes, booked, or rejected - through `setStageAndAdvance`, which then
  moves on. `markSentAndAdvance` and it redirect only to this app's own queue
  paths (`isQueuePath`). The latest run is remembered in the browser so
  Follow-ups can offer "Continue your run".
- Replies (`replySuggestions`, every plan): on someone who replied, the
  recruiter pastes what they said and `POST /api/followups/suggest` returns a
  suggested answer, shown in grey behind the reply box; Tab takes it, typing
  the same opening keeps the rest offered, "Use suggestion" does the same by
  click. Nothing is read from LinkedIn. The request (`lib/reply-model.mjs`) is
  `claude-haiku-4-5` by default (`CAPTURE_REPLY_MODEL`), plain text, 400 output
  tokens, their message delimited and called data. The route checks the
  origin, refuses read-only views and other accounts' candidates and do not
  contact, and caps suggestions per account per UTC month by counting
  `reply_suggested` usage events (`CAPTURE_REPLY_MONTHLY_CAP`, default 300).
  Neither their message nor the suggestion is stored; the browser keeps a
  suggestion for the tab only, so going back does not pay twice.
- `tests/19-followup-run.spec.ts` plays it on a Basic account;
  `tests/followup-run.test.mjs` covers the list rules, the address and the
  request.

## Telling people what changed

- There is one current release with a page: `RELEASES[0]` in `lib/release.ts`
  (`CURRENT_RELEASE` is its id) and the `/whats-new` page that describes it.
  Adding a release to the front of `RELEASES` and rewriting the page is the
  whole of "tell everyone again". Earlier entries keep only their one-line
  title. The list itself is plain data in `lib/releases.mjs`; an id is the
  day it shipped, with `.2` for a second release that day, and `extension` is
  the extension version the release needs, or null; the newest one also holds
  the `fingerprint` of the download it asks for (`lib/extension-release.mjs`:
  the packaged files for a fixed origin, line endings ignored). Any change to
  what `/api/extension/download` hands out - the four extension files or the
  packager - changes it, and `npm run build` and `npm run build:hosted` then
  stop (`scripts/check-extension-release.mjs`, also asserted by
  `tests/extension-package.test.mjs`) until the manifest version is bumped
  and a release for that version and fingerprint is at the front of the list,
  with `/whats-new` rewritten. `--fingerprint` prints the value. That is what
  puts every new copy on Notifications: an extension nobody is told about is
  never installed. Never edit a shipped release's version or fingerprint to
  get past the check; whoever read it is not told again. Keep it coarse -
  a notice that fires for changes nobody has to act on gets dismissed unread,
  and it is the only channel that reaches a recruiter who does not read this
  repository.
- `Settings.seenRelease` holds the last release an account was shown, applied as
  the additive `20260924000000_settings_seen_release`. Sign-in never lands on
  `/whats-new`: an established account goes where it always did, and an
  unread release waits for it as one "What's new" link in the workspace top
  bar and a count on the bell until it is read. An account still setting up
  goes to the guide and is not told, because what changed since a version
  they never used is not news.
- Every release is also a line on Notifications (`releaseNotices`), for the
  releases shipped since the account was created. Only the current one can be
  unread, by the same rule (`releaseIsNews` in `lib/onboarding.ts`), and it
  counts one on the bell, in the layout and in `GET /api/notifications/unread`
  alike, never for a read-only view. Its line links to `/whats-new`; when it
  needs a new extension it also offers the download (only to an account that
  may download, never a read-only view) and says to generate a new capture key
  in Settings after loading it. Once Notifications is on screen it is read
  (through `markActivitySeen`, so a read-only view or a prefetch reads
  nothing), the same as client news, and Got it on What's new still reads it
  too. The page says so above the New list.
- Reading is recorded when the recruiter presses Got it, or when Notifications
  has been on screen, never by a page rendering, and through
  `requireWritableWorkspace`, so a read-only view cannot mark somebody else's
  release as read. `tests/11-whats-new.spec.ts` covers
  who is told, that sign-in is not sent there, that rendering is not reading,
  and that it is news once.
- The release page carries the extension instructions, because Chrome never
  updates an extension loaded by hand and the app is the only surface that
  reaches somebody running an old copy.
- `GET /api/capture` reports `extension.version`, read from the same
  `extension/manifest.json` the download endpoint packages. The panel compares
  it with its own and says so when it is behind, with a link to the download.
  It helps from the next extension change onward, never the one that ships it:
  the copy already installed does not contain the check.

## Screening assistant

- A Pro feature (`screening` in `FEATURE_TIERS`), at `/candidates/[id]/screening`,
  linked from the candidate row on the role page and from the person page. The
  recruiter pastes a transcript, uploads the `.txt`/`.vtt` their call app saved,
  or types notes, optionally attaches a CV, and presses Summarise. There is no
  bot, no audio and no automatic call: the transcript is what the recruiter
  chose to give it, and generation happens only on that click.
- The rules live in `lib/screening-core.mjs` and the request in
  `lib/screening-model.mjs`, both plain modules shared with the unit tests and
  `scripts/eval-screening.mjs`, so the evaluation measures exactly what
  recruiters get. One request with a structured-output schema, one retry if the
  reply is not that shape, extra fields dropped. The transcript is delimited and
  the prompt says it is data, not instructions.
- The guard against invented facts is the quote check: each fact must come with
  a passage found in the transcript (case, curly quotes and spacing ignored,
  eight characters at least). Without one the value is still shown, marked "No
  quote found", for the recruiter to check. Nothing reaches the person until all
  four facts (salary, notice, location and remote, right to work) are confirmed
  card by card or marked not discussed; a fact not discussed leaves what was
  confirmed before. Saving moves the candidate to Screened from any earlier
  stage and records whether they agreed to be put forward to this client.
- The model is `CAPTURE_SCREENING_MODEL` (default the current Opus until the
  evaluation picks one), effort `CAPTURE_SCREENING_EFFORT` (never sent to Haiku).
  Models that take it get the server-side refusal fallback. The CV is a PDF of up
  to 5 pages and 4 MB, sent with that one request and not stored unless the
  recruiter ticks to keep it for clients (see CVs on client pages); transcripts
  are capped at 60,000 characters, so server actions accept 6 MB bodies.
- `AiUsage` caps summaries per account per UTC month
  (`CAPTURE_SCREENING_MONTHLY_CAP`, default 100). The claim is a conditional
  increment taken before the call and refunded if the call fails; the screening
  itself is claimed by status, so a double click pays once. A failed or capped
  summary keeps the transcript as a draft to try again.
- Transcripts are deleted 30 days after they were added (`lib/retention.ts`):
  at sign-in, on every screening action, and by `scripts/purge-transcripts.mjs`
  (dry run by default, `--apply` needs `PURGE TRANSCRIPTS` typed). Screens treat
  an expired transcript as gone even before it is purged, and the recruiter can
  delete one early. Summaries and confirmed facts stay. "Don't keep the
  transcript in Retrivr" on the form means it is never written: the request
  carries it, the summary keeps its quotes, and a failed or capped summary
  leaves no draft behind rather than a saved copy.
- The form opens on "Add meeting note or transcript" (or an upload, or a saved
  draft) rather than showing an empty box. "Fold away" closes it again and
  keeps the text in the form, and the button then says a note is there.
  "Save to their record" (`intent=save` on `summariseScreening`) keeps the
  text as a `PersonNote` on the person, with the role it was written for,
  for good - no model call, no cap claim, no screening row, no 30 days. It is
  refused while "Don't keep" is ticked and when the candidate has no person
  yet; the box then empties and folds. While the summary runs, a bar paced
  to the usual time names the stage and stays full until the facts appear. Its
  ticking writes to the page through refs: setting React state while the form
  is pending ends `useFormStatus` early in this React version.
- `UsageEvent` (`lib/usage.ts`) records counts and timings only, in our own
  database: `quote_missing` per field at summary time, `ai_field_edited` per
  field the recruiter changed, `screening_confirmed` with the seconds from
  adding the call to confirming it. Never a name, a transcript or a message.
- Paid model runs are scripts, never tests: `scripts/make-synthetic-screenings.mjs`
  writes the 15 fictional calls and their answer key to
  `tests/fixtures/screening/` once; `scripts/eval-screening.mjs` scores one or
  more models against it. Both share `scripts/paid-run.mjs`: they print an
  estimate and stop unless given `--approve-cost` and `--reason`, run at most
  once a day each, never in CI, and append every run to
  `prisma/private-local/paid-model-runs.jsonl`. Each run needs explicit approval.
- `tests/13-screening.spec.ts` covers the flow against the local stub (an
  invented quote, a malformed reply, a refusal, an outage, the cap, the CV
  limits, retention, Basic accounts, foreign ids and read-only views);
  `tests/screening.test.mjs` covers the rules and the scripts' guards.

## Client email

- A Pro feature (`clientEmail` in `FEATURE_TIERS`), shown under a confirmed
  screening on the screening page, and only once the candidate has agreed to be
  put forward to this client (`Screening.representConsentAt`, ticked when the
  screening is saved or recorded afterwards with `recordRepresentConsent`).
- `lib/client-email.ts` builds the subject and body from the confirmed facts,
  the person's skills and motivation and the recruiter's name: no model call.
  It says the facts are the candidate's own words and unverified, and passes
  through `normalizeMessage` like every other outgoing message.
  `components/ClientEmailComposer.tsx` keeps it editable and cleans pastes.
- Capture never sends it. "Open in email" is a `mailto:` link built from the
  recipient typed at that moment, the subject and the CRLF body; past
  `MAILTO_LIMIT` it opens with the subject only and copies the body instead.
  The recipient field has no form name, so it is never submitted or stored, and
  the recipient is encoded so it cannot add headers such as `cc`.
- "Mark as sent" (`markClientEmailSent`) records `clientEmailSentAt` once,
  moves the candidate to Submitted from any earlier stage, puts them on the
  role's client link (see Client links), and records a `client_email_sent`
  usage event. Neither the recipient nor the text is kept.
- `tests/15-client-email.spec.ts` covers the consent gate, the mailto address,
  paste cleaning and copying, the long-email fallback, nothing stored, foreign
  ids and the read-only view; `tests/client-email.test.mjs` covers the builder.

## Client links

- Every plan (`clientShortlists` in `FEATURE_TIERS`). A role has one client
  link: a `Shortlist` of kind `role`, made the first time someone is put
  forward, listing everyone put forward on one page the client opens without
  signing in. The design and its decisions are in
  `docs/plans/client-shortlist.en.md`.
- Custom shortlists (`kind` `custom`, `app/actions/custom-shortlists.ts`):
  any people, for one client, open 60 days from creation or from "Keep open
  60 more days". `/shortlists` is a library to read and manage, with no New
  shortlist button of its own; building one is `/shortlists/new`, started
  from the New shortlist button on People (which has no row checkboxes: the
  people are found by name on the new page), a person's page, or a role's
  "From your database" matches, with the people (`p`) and the client in the
  address. Its back link returns to People. The client is settled by
  the GET form before anything is saved, so each person's consent is worked
  out for that client: consent Capture already has for it (`knownConsentAt`)
  shows as "Agreed before", anyone else needs the tick, and do-not-contact
  people stop the save. The client cannot be edited afterwards, only the name:
  everyone on it agreed to that client.
- Below Pro at most `SHORTLIST_LIMITS.basic` (3) custom shortlists are active
  (not closed, not expired) at once; a role's own link never counts. The count
  and the insert share one serializable transaction, on creating, reopening an
  expired one and making a new link for a closed one. Reaching the limit only
  refuses: links already sent keep working after a downgrade or a trial ends.
  The limit is shown ("2 of 3 active"), because it is a limit, not a hidden
  Pro feature.
- The library lists open shortlists, then "Closed and expired", most recent
  first. A closed or expired one has Reopen: a closed one through
  `newShortlistLink` (same people, new address; the old one stays dead), an
  expired one through `keepShortlistOpen` (the same address for 60 days).
  At the limit Reopen is disabled with "3 of 3 open on your plan" beside it,
  so the refusal is read before a click; the server still refuses. Closed and
  expired ones can be deleted (`deleteShortlists`): Delete in the row, or
  ticked together with Select all and "Delete N selected" (row checkboxes
  join the bar's form through `form=`), each behind a confirmation. It
  removes the links, items and answers (cascade) and a nameless
  `shortlist.deleted` audit event per shortlist; people stay. An open one is
  never deleted, even by a forged request: close it first.
- What a client sees is `clientProfile` in `lib/client-profile.ts` and nothing
  else, shared with the client email. Every `Person` and `Candidate` column is
  classified there as shown or hidden, and `tests/client-profile.test.mjs`
  reads the schema, so a new column fails until it is classified. Never shown:
  the LinkedIn address and member id, contact details, notes, revisit dates,
  do not contact, stages, outreach, other roles, transcripts or the budget.
- "Put forward" on a candidate row (`putForward`) needs the person's agreement
  to be put forward to this client: a screening's `representConsentAt`, or any
  earlier screening or shortlist for the same client (`clientKey` matches
  spellings and company suffixes), makes it one click; otherwise the recruiter
  ticks "agreed to be put forward" and that statement is the recorded consent.
  It moves the candidate to Submitted from any earlier stage and sets
  `submittedAt`. Rejected, placed and do-not-contact people, and closed roles,
  are refused. "Take off" removes them from the page at once.
- `/s/<accessId>.<nonce>.<hmac>` is signed with `SHORTLIST_LINK_SECRET` (32+
  characters, server only, not the booking secret) over the access and its
  stored nonce (`lib/shortlist-core.mjs`), so the recruiter can copy it again,
  a database copy cannot mint one, and "Replace the link" kills the old address.
  "Close the link" sets `revokedAt`; a closed role closes its link. Changing the
  secret stops every link already sent.
- The page reads live (`loadClientPage` in `lib/shortlists.ts`): someone who
  becomes do not contact, is rejected or moves role leaves it at once, and any
  doubt about a link shows "no longer active" with at most the recruiter's
  name. It is `noindex`, sends no referrer to other sites (`same-origin`,
  for the reason given under Booking page), gets the bare header, and has no
  session. A view is counted at most once per ten minutes per link, never when
  the owner opens their own link; `/shortlists/[id]/preview` shows the same
  component inside the app and is never counted.
- Capture sends nothing to the client: "Open in email" is a `mailto:` built
  like the client email's, from a recipient field with no form name.
- Who can open a page is the recruiter's choice, per role link or shortlist
  (`components/ShortlistSharing.tsx`, `app/actions/shortlist-access.ts`):
  "Anyone with the link" (one `ShortlistAccess` with no email) or "Only these
  people" (one access per email, at most 20, each with its own link and its
  own "Open in email to ..."). Switching revokes every address of the other
  kind; removing a person revokes theirs. "Replace the link" and reopening go
  through `replaceLinks`, which replaces the addresses of whichever kind is in
  use and never creates a public link on a named-only page, and
  `ensureRoleShortlist` leaves a named-only role link as it is.
- A named link first asks for the address it was sent to (`openNamedLink`,
  trimmed and lower-cased, ten wrong tries an hour per link), showing nothing
  about the candidates or the client before then. A match sets the HttpOnly
  `capture_shortlist_gate` cookie, path-scoped to that link's own `/s/<token>`
  and signed over the access and its nonce, for 30 days; the page and
  `decideShortlistItem` both require it. It stops a forwarded link opening for
  someone else; it does not prove who reads the inbox, because Capture sends
  no code, and the panel says so. Recipients' addresses are never exported.
- An answer records the access it came from, so a named person's answer shows
  their address beside it on the role page and in the library.
- Client interviews (`lib/interviews.ts`, `app/actions/interviews.ts`). They
  are arranged by hand (see Arranging a client interview). A role may still
  carry weekly interview hours (`interviewWindows`, `interviewTimezone`,
  `interviewDurationMins`, `interviewLocation`) set before the hours form
  was removed; those still offer times through `{{interview_link}}` so links
  already sent keep working, but nothing sets or edits them any more.
- `{{interview_link}}` becomes `/book/<candidateId>.<day>.i.<sig>`: the booking
  token with its kind inside the signature, so a screening link cannot become
  an interview one and old links read as before. It is a gap unless
  `interviewLinkState` allows it: the role is open with hours, the candidate
  is not rejected, placed or do not contact, they are on the role's link with
  consent, and the client answered Interview. The follow-up run's
  client-wants-to-meet message uses it when it exists and asks for times when
  it does not.
- The interview page names the client (the candidate agreed to them) and
  offers the role's hours from a day ahead to three weeks, less every
  interview booked with the same `clientKey` on any role. `bookInterview`
  re-reads everything from the link, books only a time still offered, and
  inserts `Booking` (kind `interview`, mode `video` or `in_person`) with an
  `InterviewSlot` whose (owner, client, start) key refuses a double booking
  under a race. The candidate moves to the new `interview` stage ("Client
  interview"). The recruiter's own screening slots ignore interviews.
- The client's page lists upcoming interviews (their zone, a meeting link or
  address, Add to Google Calendar, an `.ics` behind the same link) with
  "Can't make this time": it cancels, frees the slot, puts the candidate back
  to Submitted and refreshes the client's Interview answer so they reappear
  under "Client wants to meet". An answer cannot change once an interview is
  booked. The recruiter sees and cancels it on the role page like a call.
- The client answers per person: "Interview <name>", or "Not for us" with an
  optional reason chip and a line of at most 280 characters
  (`decideShortlistItem`, constants in `lib/shortlist-decisions.mjs`, which the
  browser can load; `lib/shortlist-core.mjs` cannot, it uses `node:crypto`).
  The action has no session: it checks the origin, re-reads the link, refuses
  anyone no longer visible on it, throttles per link, and writes the answer
  with the link it came from, a nameless `shortlist.decision` audit event and
  a `client_decision` usage event. An answer can be changed until an interview
  is booked. Capture never changes a stage on a client's answer: the role
  page shows it, with "Mark rejected" beside a "not for us".
- Follow-ups lists "Client wants to meet" (only when it has anyone) for an
  Interview answer on a role link, with no message logged since and no
  interview booked; it is its own group, `m`, in the follow-up run.
- Every client reviews first. The role's "Before an interview" switch
  (`Role.clientReviewFirst`) and the client's own "When could you
  interview?" form went with the hours form when interviews came to be
  arranged by the recruiter: `clientChoices` always reads review-first with
  no hours to ask for, and `interviewLinkState` no longer reads the column.
  The columns stay (dropping them would be its own approved migration). The
  Client link button counts people on the page ("· 2 people"), not links.
- `tests/23-client-links.spec.ts`, `tests/24-custom-shortlists.spec.ts`, `tests/25-named-access.spec.ts` and `tests/26-interviews.spec.ts` play the client (and the candidate) in a second browser context
  with no session; `tests/shortlist.test.mjs` covers the rules.

## CVs on client pages

- A client reads a person's CV where Capture has one, in place of the
  confirmed facts, skills and motivation; where there is none, the client's
  page is as it was. The LinkedIn profile is never shown to a client, with or
  without a CV (`profileUrl` stays hidden in `lib/client-profile.ts`).
- `PersonCv` (one per person, cascade): the PDF as uploaded, in the database
  because the host has no lasting disk, with `contactsCheckedAt`. Uploads go
  through `uploadCv` (`app/actions/cv.ts`, rules in `lib/cv-core.mjs`,
  `tests/cv.test.mjs`): a PDF of up to 4 MB, a cleaned file name, replacing
  the last one. The contact-details notice (`CONTACTS_NOTICE`) sits between
  the file and the button in `CvUpload`, and the button stays off until its
  box is ticked; the server refuses an upload without the tick, so it cannot be
  clicked past. Uploaded from the person page (CV section, with Replace and
  Delete) or kept from the screening form ("Also keep this CV on their
  record", with the same tick, saved before the summary is asked for).
- The client's page reads live, so a CV uploaded, replaced or deleted while a
  link is open is what the client's next look shows. Each entry carries the
  upload time as `v`, so a browser never shows an old copy. The file is
  served from `/s/<token>/cv/<itemId>` only through `loadClientPage` (a live
  link, the named-link gate cookie, someone still visible on the page), from
  `/shortlists/<id>/preview/cv/<itemId>` for the in-app preview, and from
  `/api/people/<id>/cv` for the recruiter's own workspace. All three are
  `no-store`, `noindex`, and may be framed by this site only: `next.config.mjs`
  keeps `DENY` for every other address. No `sandbox` CSP on them, because
  Chrome will not render a PDF under one.
- Putting forward someone without a CV asks first (`NoCvGuard`): Put forward,
  Add to client link, and creating or adding to a shortlist open a dialog
  saying the client will see only the confirmed details. Cancel, "Skip for
  now" (a CV often comes later), or upload it right there with the same tick,
  after which it goes ahead by itself. The dialog keeps the list it opened
  with, because the upload refreshes the page under it. Until a CV arrives the
  role row and the shortlist library show "No CV · Upload".
- The export lists which CVs are kept (`cvs`: names, sizes, dates), not the
  files; a CV is not carried by `scripts/import-accounts.mjs` and is uploaded
  again after a move. `20261023000000_person_cv` adds the table (additive;
  see Hosting for when it was applied).
  `tests/29-client-cv.spec.ts` plays the recruiter and the client.

## Arranging a client interview

- Once a client wants to meet someone, the recruiter arranges it from one
  page, `/candidates/[id]/interview` (`clientShortlists`, every plan), with
  no weekly interview hours needed: client diaries change too often to keep
  standing hours, and most recruiters never agree them up front. "Arrange
  interview" leads there from the candidate's row on the role page (whenever
  the client answered Interview, on the role's link or a custom shortlist for
  the same `clientKey`, and nothing is booked), from the line on
  Notifications, and from both "Client wants to meet" groups on Follow-ups.
  The page reads only; `lib/arrange.ts` loads what it needs under the owner.
- Two ways, side by side (`app/actions/arrange-interview.ts`):
  "You agreed a time" (`setInterviewTime`) books one date and time typed in
  a chosen zone; "Offer a few times" (`offerInterviewTimes`) saves up to
  three as an `InterviewOffer` for the candidate to choose from. Both take a
  length and an optional meeting link (https only) or address, refuse a time
  that overlaps another interview with the same client (and the
  `InterviewSlot` key refuses a race), and, in the same transaction, put the
  candidate on the role's client link with the consent Capture already has
  for this client - or the tick the page then asks for - carrying a custom
  shortlist's Interview answer across. Rejected, placed, do-not-contact and
  closed roles are refused. The rules are in `lib/arrange-core.mjs`
  (`tests/arrange.test.mjs`).
- A set time is a `Booking` (kind `interview`, `noticeVersion` "arranged",
  the person's email if known) with its `place` and `timeZone`; the
  candidate moves to Client interview and the client's page lists it. An
  offer makes `{{interview_link}}` a link without hours or an answer
  (`interviewLinkState`'s `offered`), and the candidate's page shows exactly
  its open times (`openOfferTimes`: not passed, not within an hour, not
  clashing); booking one claims the offer by its state (`bookingId`), and a
  set time or a new offer withdraws an open one. Offered times must be two
  hours ahead at least.
- After either, the email to the candidate is ready on the page, the same
  composer as the client email (`ClientEmailComposer`, body from
  `arrangeMessage`): the address Capture has for them filled in but not a
  form field, subject and body editable, "Open in email" a `mailto:` (past
  `MAILTO_LIMIT` the subject only, with the body copied), and Mark as sent
  recording subject and body in their outreach through `markAsSent`. Capture
  sends nothing, to the candidate or the client. Cancel the interview is the
  existing `cancelBooking`; "Withdraw these times" closes an offer.
- `20261022000000_interview_offers` adds `InterviewOffer` and the nullable
  `Booking.place`/`timeZone` (additive). The offer is not exported or
  imported; the two booking columns are `lateColumns`. See Hosting for when
  it was applied.
  `tests/28-arrange-interview.spec.ts` plays the recruiter, the candidate and
  the client.

## Notifications

- Formerly Activity: `/notifications`, with `/activity` redirecting to it. It
  carries client news (below) and each Capture release (see Telling people
  what changed), newest first.
- What a client does on a link reaches the recruiter inside Capture, never by
  email: a `Notification` row (`lib/notifications.ts`) written in the same
  transaction as the action - a client's answer (`decideShortlistItem`; a
  changed answer before it was seen updates the unread row instead of adding
  one), the first ever open of an access (`recordClientView` reports it), a
  candidate booking the client's interview, the client's "Can't make this
  time", and the client setting their interview hours. A row holds ids only;
  the sentence is written when it is read, so it follows renames and goes
  (cascade) with whatever it points at.
- The signal is a red count: the bell in the workspace top bar and the
  Notifications item in the sidebar (`components/ActivityBell.tsx`). The layout
  renders the count; the bell asks `GET /api/notifications/unread` again
  every minute while the tab is visible and when it comes back into view, and
  never marks anything. Red is used only for "new"; cobalt stays the accent.
- Seen is recorded by `MarkSeen` (an effect after the page is on screen,
  through `markActivitySeen` and `requireWritableWorkspace`), never by
  rendering, so a prefetch or a read-only view marks nothing. `/notifications`
  marks everything up to when it rendered, a role page that role's, the
  shortlists library the custom shortlists'. The page keeps its New marks
  until it is next opened; only the bell counts again.
- A role page marks the rows with news (`New`) and, for a person also on a
  custom shortlist for the same `clientKey`, shows that shortlist's newer
  answer with "Add to client link"
  (`adoptShortlistAnswer`): it puts them on the role link with the consent
  the shortlist recorded and copies the answer, so the usual "Client wants to
  meet" and `{{interview_link}}` see it. Follow-ups lists Interview answers
  on custom shortlists not yet brought across, pointing at the matching role.
  On `/notifications` an Interview answer (or a client's "Can't make this
  time") has "Arrange interview" instead, one per matching role, named when
  there is more than one; arranging also brings the answer across, and the
  button goes once an interview is booked (see Arranging a client interview).
- `20261021000000_client_notifications` adds the table (additive; see Hosting
  for when it was applied). It is not
  exported or imported. `tests/27-activity.spec.ts`.

## Booking page

- Available on every plan (`booking` in `FEATURE_TIERS`). The recruiter sets
  weekly hours, time zone, call length, minimum notice, how far ahead, a
  meeting link and/or a phone option, and a privacy notice at
  `/settings/booking` (`updateBookingSettings`). An empty notice uses
  `defaultPrivacyNotice`, with the account email as the contact unless another
  is given.
- `{{booking_link}}` in a template becomes each candidate's own link,
  `/book/<candidateId>.<issuedDay>.<hmac>`, signed with `BOOKING_LINK_SECRET`
  (32+ characters, server only) over the candidate and the UTC issue day
  (`lib/booking-core.mjs`). Making a link writes nothing, so rendering the
  outreach queue stays pure. A link lasts 30 days, and gives way to a gap rather
  than a dead link when booking is not set up, the role is closed, the candidate
  is rejected or placed, or the person is do not contact. Changing the secret
  stops every link already sent. The role page also offers Copy booking link.
- `/book/[token]` needs no session and `ApplicationShell` gives it a bare
  header. It shows the recruiter's name and the role title, never the client,
  free times in the candidate's own time zone (read from the browser,
  changeable), a required consent box, an optional "keep my details for future
  roles" box and the full notice; it is `noindex` and sends no referrer to
  any other site. Its policy, like the site-wide header in `next.config.mjs`,
  is `same-origin`, not `no-referrer`: under `no-referrer` Chrome posts a form
  with `Origin: null`, so a Book pressed before the page's script has loaded
  hit Next 14's own origin check, which cannot parse `null`, and got a 500.
  Links out (the meeting link) also carry `rel="noreferrer"`.
- `bookSlot` trusts nothing from the page: it re-reads the link, re-checks the
  candidate, throttles per candidate and per owner with the login throttle
  table, and books only a start time that `freeSlots` still offers. One
  transaction checks for an overlapping booking and inserts `Booking` plus
  `BookedSlot`, whose (owner, start) key refuses a double booking even under a
  race; it saves the email (and consent, if ticked) on the person, moves the
  candidate to Booked from an earlier stage, and writes a `booking.created`
  audit event and a `booking_link_used` usage event. Capture sends no email.
- Slots are the weekly hours stepped by the call length, from the notice to the
  horizon, less booked calls, computed in the recruiter's zone with `Intl`:
  a wall-clock time skipped when the clocks go forward has no slot, and one
  repeated when they go back counts once (`tests/booking.test.mjs`). Only
  screening calls count: a client interview is the client's time, not the
  recruiter's (see Client links), and `bookSlot` refuses an interview link.
- The candidate gets an `.ics` behind the same link; the recruiter gets the call
  on the role page and under Calls this week in Follow-ups, an Add to Google
  Calendar link, an authenticated `.ics` from `/api/bookings/[id]/ics` (own
  workspace only), and Cancel call, which frees the time and puts the candidate
  back to booking pending. Rescheduling, buffers and calendar writes are not here.
- `{{privacy_notice}}` in a template is one short line (`privacyNoticeLine`):
  a record is kept, and how to see it or have it deleted, by the privacy contact
  or the account email. It fits a LinkedIn message; the booking page carries the
  full notice.
- Calendar free/busy (`calendarFreeBusy`, every plan): on `/settings/booking`
  a recruiter may connect Google or Microsoft, offered only when the server has
  that provider's `*_CLIENT_ID`/`*_CLIENT_SECRET` and a `CALENDAR_TOKEN_KEY`.
  The scopes are the narrowest each provider documents for this - Google's
  `calendar.events.freebusy`, Microsoft's `Calendars.ReadBasic` with
  `offline_access` - and only busy start/end times are read, never what the
  events are. `/api/calendar/connect/[provider]` sends the signed-in account
  (never a read-only view) to the provider with a signed, ten-minute state;
  `/api/calendar/callback/[provider]` keeps the connection only when that state
  names the same account and provider, and stores the refresh token encrypted
  with AES-256-GCM (`lib/calendar-core.mjs`). Access tokens live in memory.
- `freeSlots` subtracts the calendar's busy periods from the weekly hours.
  Every provider request is server side with a three-second limit; a failure
  is recorded as `lastErrorAt`, the page carries on with the weekly hours, and
  the recruiter is warned on the booking settings until a read succeeds.
  Disconnecting revokes Google's grant and deletes the token either way.
  `CalendarConnection` is never exported or imported. `tests/18-calendar.spec.ts`
  plays both providers through the local stub (`CAPTURE_TEST_CALENDAR_BASE_URL`,
  honoured outside production only); `tests/calendar.test.mjs` covers the
  encryption, the state, the requested scopes and reading busy replies.
- `tests/14-booking.spec.ts` plays the candidate in a second browser context
  with no session: booking, two people taking one time at once, forged, altered
  and expired links, closed roles, do not contact, cancelling, a Basic account,
  foreign ids, the read-only view and a phone-width page.

## Talent database: search, matches, reminders, review

- The rules are in `lib/talent.mjs`, shared with `tests/talent.test.mjs`:
  reading money, the role budget, scoring, the people-search filters, revisit
  dates and stale facts. No model, no embeddings, no network: matching is
  whole-word matching over each person's lower-cased `searchText`.
- A role may carry an optional annual budget (`Role.budgetMin/Max/Currency`),
  on every plan, typed as "85k" or "£85,000", turned round if given backwards,
  and shown under the client.
- People search (`peopleSearch`, Pro) on `/people`: every word must appear in
  `searchText`, which holds the name, headline, location, skills and
  motivation; filters on confirmed facts only (salary up to, notice up to,
  working pattern, right to work, confirmed within). Someone with nothing
  confirmed for a filter is left out of it. Without the feature the search
  stays on name and headline, as before. Facts confirmed more than six months
  ago are marked "May be out of date" wherever they are listed.
- The People search box suggests as the recruiter types (`PeopleSearchBox`,
  `GET /api/people/suggest`): the top six by `rankSuggestions` - every word
  found, a name before a headline before anything else, the start of a word
  before the middle - with the filters already set applied. Both the page and
  the endpoint build their query with `peopleWhere` (`lib/people-search.ts`),
  so a suggestion is always something Search would list, and Basic stays on
  name and headline in both. The endpoint reads the workspace on screen (a
  read-only Admin view suggests that workspace's people), returns only what a
  row shows, and writes nothing. A suggestion opens the person; Enter with
  none chosen still runs the full search. The filters are chips under the
  People box (`PeopleBox`): each shows its value once set, opens a small
  editor, and its cross clears it; they navigate, so the address still holds
  them.
- Talent matches (`talentMatches`, Pro): the role's briefing key skills and
  search titles are scored against people not on the role and not do not
  contact: three points a whole phrase, one a significant word. People whose
  confirmed salary is above the budget are left out; without a confirmed salary,
  or in another currency, they are shown as "Salary unknown"; without a budget
  nothing is filtered. Top ten, with what matched. `addPersonToRole` files the
  existing person against the role as sourced. A fixed fictional set of 300
  people with known right answers measures the top ten in the unit tests.
- Revisit reminders (`revisitReminders`, Pro): a screening's revisit hint is
  offered as a date (`suggestRevisitDate`) when it is saved, and set or cleared
  on the person page (`setRevisit`). Follow-ups lists "Due to revisit" within a
  week or overdue, excluding do not contact. Computed on page load; no
  scheduler, no email.
- Notes (`people`, every plan): a person's page lists their `PersonNote`s,
  newest first, with the role a note was saved from, and takes new ones
  (`addPersonNote`). Notes are the recruiter's own record and have no expiry:
  they go when deleted (`deletePersonNote`, with a confirmation) or when the
  person is erased (cascade). The same text saved to the same person within a
  minute is one save. Shared rules are in `lib/notes.ts` (server only, never a
  "use server" export, because it takes an owner id). Notes are exported as
  their own table and imported by `scripts/import-accounts.mjs`; a note on
  another account's candidate is refused. Read-only views show notes but
  cannot add or delete them.
- Import from Notion (part of `screening`): Notion is offered only when the
  server has `NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET` and a
  `CALENDAR_TOKEN_KEY`, and shown by Notion's own logo (`NotionLogo`, inline
  SVG). `/api/notion/connect` sends the signed-in account (never a read-only
  view) to Notion's sign-in and page picker with a signed ten-minute state;
  where to come back to is a short-lived cookie limited by `safeReturn` to a
  screening page or Settings. `/api/notion/callback` keeps the connection only
  when the state names the same account, storing access and refresh tokens
  encrypted in `IntegrationConnection`. Search (`/api/notion/pages`) and one
  page as text (`/api/notion/pages/[id]`) are server-side, read-only, on a
  click, Notion-Version `2026-03-11`; an expired token is refreshed once, and
  failures ask to reconnect. `lib/notion-core.mjs` turns blocks into lines,
  including a `meeting_notes` block's summary, notes and transcript; images and
  unsupported blocks are skipped and text past 60,000 characters is cut with a
  warning. The text lands in the box for the recruiter to read first; nothing
  from Notion is stored until they summarise or save. Settings > Connected
  apps shows the connection and Disconnect, which deletes the tokens (Notion
  has no revoke endpoint). `IntegrationConnection` is never exported or
  imported. `tests/20-notes-notion.spec.ts` plays Notion through the local stub
  (`CAPTURE_TEST_NOTION_BASE_URL`, outside production only);
  `tests/notion.test.mjs` covers the state, the return path and the blocks.
- `20261006000000_person_notes_integrations` adds both tables (additive); see
  Hosting for when it was applied.
- Import from a spreadsheet (`peopleImport`, every plan) at `/people/import`, from the Import people
  button on People: an `.xlsx`, a `.csv` or Excel's UTF-16 "Unicode Text", 4 MB and 2,000 people at
  most. The reader is `lib/sheet-read.mjs`, a small zip-and-XML reader with no dependency
  (SheetJS on npm is unpatched and vulnerable; do not swap it in): every size is capped before it is
  expanded, formulas are never evaluated (the saved value is used), and unclosed XML ends a linear scan
  rather than a regular expression. The rules are in `lib/people-import.mjs`; `lib/people-import-server.ts`
  looks up who exists and writes. Do not give the server module the same base name as the `.mjs` one:
  the bundler resolves `@/lib/people-import` to whichever extension it tries first.
- Files arrive in every shape, so the layout is read, not assumed (`prepareTable`, shared with
  `tests/people-import-dirty.test.mjs`, which holds the odd files it was tuned on): the visible sheet whose
  headings name the most known columns (hidden sheets are skipped); the heading row among the first ten,
  or none when the first row is a person; columns by heading and then by contents (a column of LinkedIn
  addresses or emails is one whatever it is called, and contents outvote a heading such as "Contact"
  full of emails); several columns into one location, skills or note; title plus company as the
  headline; the link behind a cell or a `HYPERLINK` formula; merged cells filled the way Excel shows
  them; a one-cell row above each group read as the group's role; "SMITH, Jane" turned round and
  capitals written normally only when the whole column is like that; a name from the start of a cell
  that holds everything, or from the email when there is no name column; placeholders, a repeated
  heading row and a totals row refused as "Not a name". Each reading is one line on the page with one
  button that reads it the other way; whatever is left over is kept in the person's note unless the
  recruiter says not to. Nothing is guessed silently.
- A column that may hold roles (`classifyRoleColumn`) is read as roles without asking only when most of
  its values are the account's existing roles, or its heading says so ("Applied for", "Vacancy") and it
  would create no more than ten new roles or 30% of the rows, whichever is fewer. Otherwise - and always
  for "Role", "Position" or "Job" in a new account - the recruiter is asked what it means, with nothing
  pre-chosen, before Import is possible. Each role named (`resolveRoleValues`) goes to the one open role
  of that exact title; two of that title, a closed one, a close spelling or a new name default to no role
  and offer the choices in one list, so no role is created or attached on a guess. A person on several
  rows is one person on each of their roles; nobody is put on a role twice. Role ids from the page are
  checked against the account again when writing.
- Undo (`undoImport`, `ImportBatch`): every person, role and candidacy an import creates carries its
  `importBatchId`, and the empty fields it filled are listed on the batch. For 7 days the done screen and
  People offer Undo import, asked in place. It removes what the import made except people worked on since
  (moved on from sourced, contacted, screened, booked, given a note, edited or put on a role by hand),
  who stay and are named; roles go only when nothing else holds them; filled fields are emptied only if
  unchanged; do-not-contact stays. Undo is not erasure and adds nothing to `Suppression`. The batch is
  never exported or carried by `scripts/import-accounts.mjs`; it belongs to the database it ran on.
  `20261015000000_import_batches` adds the table and the three nullable columns (additive); see Hosting
  for when it was applied.
- Two steps over one upload. Preview (`previewPeopleImport`) reads the file and reports what would happen,
  writing nothing; Import (`runPeopleImport`) re-reads the same file and trusts nothing the preview said:
  every choice goes through `parseOptions`, and every lookup is repeated. The file is never stored. Rows
  are matched by member id, then canonical profile link, and by email only for a row with neither - never
  by name. Anyone in `Suppression` (on any of their identifiers) is skipped, so an erasure cannot be
  undone by re-importing the list; a repeat within the file is combined with the first row, and any row
  can be left out from "Check every row".
  Someone already in People is never overwritten: a row can only add do-not-contact (the safe direction;
  any value but a plain no counts) and, if ticked, fill an empty headline, location, skills or email.
- The page is three steps with one decision each (Choose file, Review, Done), not a long form. Choosing a
  file reads it and moves straight to Review, which answers one question - "N people will be added" -
  with the first five names, what else happens (only non-zero lines) and one commit card: the
  legitimate-reason box, the button and, when it is off, a visible reason beside it. The columns are not
  shown unless no column looks like a name or the recruiter presses Change columns; "fill empty fields"
  appears only when someone in the file already exists. Each new screen takes focus at its heading and
  results are announced through a status region; the lists are lists, not tables, so a phone needs no
  sideways scroll, and the commit card sticks to the bottom of a small screen. The disabled state of
  `.btn-primary`, `.btn-secondary` and `.btn-quiet` is now at least 4.5:1 (it was 1.5:1 for the primary).
- Imported people carry identity and description only. Salary, notice and right to work are not
  imported: they count in search only once confirmed on a screening, and a cell is not a confirmation.
  An imported email has `emailSource: "import"` and no consent date; Capture never sends email anyway.
  Every new person gets a `PersonNote` saying which file and day they came from (and their notes cell as a
  second note); that also keeps `dropIfOrphan` from removing them when their only role goes. The import
  needs the recruiter to tick that they have a legitimate reason to hold these records. The audit event
  `people.imported` and the `people_imported` usage event carry counts only, never names or a file name.
- `tests/people-import.test.mjs` (reader limits, hostile files, rules), `tests/people-import-dirty.test.mjs`
  (odd files, each ten fictional people at most, and the role rules; workbooks with sheets, links, merges
  and formulas are built in memory by `tests/xlsx-fixture.mjs`) and `tests/22-people-import.spec.ts`
  (preview writes nothing, notes, suppression, other accounts, mapping by hand, the role question, role
  matching, readings turned off, rows left out, undo and what it keeps, another account's undo refused,
  refused files, orphan guard, read-only view, phone width).
- Review list (`privacy`, every plan) at `/people/review`: people with no
  update, contact or candidacy activity for 12 months. "Keep for another year"
  (`keepPerson`) touches the record and writes a nameless `person.kept` audit
  event; erasing stays on the person page behind its typed confirmation.
- `tests/16-search-revisit.spec.ts` covers the budget, search and filters,
  matches (budget, labels, add), reminders from the person page and from a
  screening, the review list, Basic accounts and the read-only view.

## Instant Match

- A Pro feature (`instantMatch` in `FEATURE_TIERS`) on the People page
  itself. One box (`components/PeopleBox.tsx`) replaces the search bar: Match
  is where a Pro account starts, and Search is chosen by hand from the mode
  menu. Pasting into Search something longer than `LONG_PASTE` (150
  characters) or with a line break moves it to Match and says so, with
  "search instead". Match calls the model only on Enter or the arrow, never on
  a paste or a mode change; Search never calls it. A read-only view, or an
  address that already holds a search, starts in Search; Basic gets Search
  only, with no mode menu and no filters.
- Under the box sits one row of chips: in Search the filters, before a match
  the open roles that have a description ("Match <role>", `?role=` puts the
  description in the box), and during a match its requirements. The match
  replaces the people list on the same page (`/people?c=…`); "All people"
  clears it. `/people/match` only redirects to People with the same address
  state, so links already sent keep working. The page data comes from
  `loadMatchPage` (`lib/match-page.ts`).
- The model does one thing: words in, criteria out (`lib/match-model.mjs`,
  `claude-haiku-5-5` by default, `CAPTURE_MATCH_MODEL`, effort low, a
  structured-output schema, one retry). It gets the brief, or the current
  criteria and one sentence of change - never a person from the database.
  Neither the brief nor the sentence is stored; the browser keeps the brief
  for its tab so "Edit brief" can bring it back. Matching, ranking, loosening
  and "not a fit" are plain code in `lib/match-core.mjs`, shared with
  `tests/match.test.mjs`. There is deliberately no AI explanation per person:
  recruiters do not want more to read at that point.
- Criteria are chips the recruiter can change: must-haves (every one
  required, each with up to four other spellings), nice-to-haves (rank only),
  other titles, and requirements checked against confirmed facts (salary,
  notice, working pattern, location, right to work) and against the headline
  (seniority). A fact not confirmed is a miss marked as such unless the
  recruiter counts unconfirmed as a fit for that requirement. What the records
  cannot answer (a degree, an industry) is listed as "Check these yourself" and
  never used to match. Do not contact is never shown.
- The address is the whole state: `c` the criteria (base64url, cleaned on
  every read), `x` the people set aside. Every change is a navigation, so Back
  and the toast's Undo restore the previous match.
- When the match disappoints: "One thing off" lists people missing exactly one
  requirement, with which; the loosening offers come from them, and when there
  are none, from pairs of requirements. Every offer's number is a recount of
  everyone close under the loosened criteria, so it is the number that
  appears. "Not a fit" sets a person aside and, given a reason (too junior,
  too senior, too expensive, notice too long), tightens the criteria past them
  so people like them go too. "Look outside your database" turns the criteria
  into a LinkedIn keyword string, opened on a click, copied for Recruiter, or
  saved as a search (`saveMatchSearch`). Nothing is sent to LinkedIn.
- Saving to a role's briefing is the recruiter's explicit choice
  (`saveCriteriaToBriefing`): skills and titles are added, never replaced, and
  the budget changes only if ticked. A briefing created this way has only
  skills, titles and pay, and the role page hides its empty sections.
- `POST /api/match/criteria` checks the origin, the feature for both accounts
  and refuses read-only views; it caps briefs plus adjustments per account per
  UTC month by counting `match_brief_read`/`match_adjusted` usage events
  (`CAPTURE_MATCH_MONTHLY_CAP`, default 300), and counts only successes.
  `POST /api/match/event` records which way out was taken (`match_loosened`,
  `match_not_fit` with the reason's index, `match_handoff`): counts only.
- `scripts/eval-match.mjs` scores that call against fictional briefs with
  known answers in `tests/fixtures/match/briefs.json` (a messy note, a day
  rate, a brief in Chinese, a prompt injection, adjustments), through the
  paid-run guard; `--again-today` allows a second run the same day to check
  a fix the first found, and is logged as a repeat. Habits the model keeps
  whatever the prompt says are put right in `criteriaFromModel` (a sector or
  industry background moved to the checks, "not required" notes dropped).
- `tests/21-instant-match.spec.ts` plays it against the local stub (only the
  brief is sent, chips, Back/Undo, exact loosening, not a fit, adjusting,
  briefing, add to role, handoff, refusal, outage, cap, forged origin, Basic,
  read-only view, phone width, the long paste that switches to Match without
  reading anything, and starting from a role).

## Accounts and authorization

- `lib/auth.ts`: opaque hashed database sessions, HttpOnly/SameSite cookies,
  fixed expiry, active-account and auth-version checks, same-origin action checks.
- `middleware.ts` first redirects a page at another host than `APP_ORIGIN`'s
  (see Hosting). It then answers a POST to any page route with a plain 403 when its
  Origin is not a URL (`null`) or names another host than the request's - the
  comparison Next makes itself, made before Next's parse of the header can
  throw. A post with no Origin is left to `assertSameOrigin()`; `/api` routes
  check their own callers and are not matched. `tests/14-booking.spec.ts` B9
  books with JavaScript off and posts the same form from both kinds of origin.
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
- Admin can permanently delete a recruiter account from `/admin/[id]` (`deleteAccount`): never an administrator or oneself, never from a read-only view, and only after the account's email is typed. Business tables use `onDelete: Restrict` on the user, so the action removes bookings, searches, roles, people, templates and settings explicitly in one transaction before the user (the rest cascades). Audit events are kept and a nameless `account_deleted` event is written. `tests/21-delete-account.spec.ts`.
- Administrators still create accounts with one-time activation links (teams,
  Pro Max, anyone set up by hand). Activation links use URL fragments and expire
  after 24 hours; the raw link is shown only at creation. No default admin
  password. Anyone can also sign up themselves (see Self-serve sign-up), and
  "Forgot password" emails the same kind of link, good for an hour.
- A recruiter deletes their own account from `/account` (`deleteOwnAccount`):
  the same removal as the admin's (`lib/account-deletion.ts`), after the email
  is typed, from their own workspace only, with or without a plan. A live Stripe
  subscription is cancelled first, and nothing is deleted if that fails; a
  nameless `account_deleted_by_owner` event is written. `TrialClaim` and
  `Suppression` rows stay. Administrators are removed only by another one.

## Self-serve sign-up

- `/signup` offers Google, Microsoft and email. It opens only when
  `signupConfig()` (`lib/signup-config.ts`) finds `BETTER_AUTH_SECRET` (32+
  characters), `TERMS_URL` and `PRIVACY_URL` (HTTPS), and a way to prove an
  address: mail (`RESEND_API_KEY` and `MAIL_FROM`) for email, the provider's
  `*_CLIENT_ID`/`*_CLIENT_SECRET` for Google or Microsoft (the same OAuth clients
  as calendar free/busy, with `/api/auth/callback/<provider>` added as a
  redirect URI). Until then the page says sign-up opens soon. Every sign-up
  ticks the terms and privacy policy, which include that Retrivr processes the
  candidate data the recruiter keeps; the version (`TERMS_VERSION`) and time
  are stored on the user.
- Better Auth (`lib/better-auth.ts`, `better-auth` pinned) proves who someone
  is and nothing more. The moment it has made a session of its own, its
  `hooks.after` deletes it, clears its cookie and issues the workbench's own
  session (`issueSessionToken` in `lib/auth.ts`), so the hashed session table,
  `capture_session`, `authVersion` revocation and the read-only admin view are
  unchanged. Passwords stay on `User.passwordHash`, checked by `login`; Better
  Auth's email and password sign-in is off. `app/api/auth/[...all]` opens only
  `POST /sign-in/social` and the two provider callbacks; every other Better
  Auth route is a 404, and the email code is sent and checked by server
  actions (`app/actions/signup.ts`) through `auth.api`.
- By email: name, address, password and the terms make a `PendingSignup` (30
  minutes; the address travels in an HttpOnly cookie, never the URL), and
  Better Auth's email-otp plugin sends a six-digit code (10 minutes, 5 tries,
  stored hashed). Codes, not magic links, because company mail scanners open
  links and spend them. A code for an address with an account is never sent;
  that address gets "you already have an account" instead, and the page says
  the same either way. Throwaway domains (`DISPOSABLE_DOMAINS`, a local list)
  are refused; sign-up is throttled per address, per IP (the last
  `x-forwarded-for` entry) and globally.
- By Google or Microsoft: the terms are agreed first, as a signed 15-minute
  cookie (`capture_signup_terms`, path `/api/auth`) the account creation looks
  for on the way back. An account is created only when the provider says it
  verified the address: a multi-tenant Microsoft app's email claim is otherwise
  whatever the tenant says. Linking a provider to an existing account by email
  follows the same rule (no trusted providers). Sign-in asks for `openid email
  profile` only, never a calendar scope.
- `databaseHooks.user.create.before` is the only place a self-serve account is
  shaped: role is never set (the column's `recruiter` default), and the fields
  are `signupSource: "self"`, `accountTier: "trial"` with seven days, the
  terms, and for a code the pending row's name and password hash. Any other
  path that would create a user is refused. Afterwards a `TrialClaim` (hash of
  the address, lower-cased, `+tag` removed) is kept for good, so deleting and
  signing up again starts with no trial; `Settings` starts with the name and
  the current release, and `account_signed_up` is audited.
- Account email comes from `lib/mailer.ts` (Resend's HTTP API): sign-up codes,
  "already have an account" and password resets, to the recruiter only.
  Retrivr still sends nothing to candidates or clients. Outside production,
  `CAPTURE_TEST_MAIL_DIR` writes each message to a file instead.
- `tests/signup.test.mjs` covers the rules and the Better Auth glue through a
  captured configuration; `tests/30-signup-billing.spec.ts` plays sign-up,
  wrong codes, closed routes, existing addresses, repeat trials, password reset
  and the provider start.

## Billing

- Stripe holds the card and the subscription. `/billing` (own account only,
  open with or without a plan) shows the plan and starts Stripe Checkout
  (`startCheckout`) for Lite, Basic or Pro, monthly or yearly
  (`STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>`); Pro Max stays "Contact us". An
  account already paying goes to Stripe's customer portal instead, which also
  changes plan, cancels, updates the card and holds invoices. `STRIPE_TAX=1`
  turns on Stripe Tax at checkout. Nothing on these pages changes a plan.
- `POST /api/billing/webhook` is the only thing that does. It checks the
  signature (`STRIPE_WEBHOOK_SECRET`) over the raw body, records each event id
  in `StripeEvent` so a redelivery does nothing, and never applies an event's
  body: `syncSubscription` (`lib/billing.ts`) reads the subscription back from
  Stripe and writes `billingPlan`, `billingInterval`, `billingStatus`, the
  period end, cancellation and `billingPastDueSince` onto the user
  (`subscriptionFields` in `lib/billing-core.mjs`). The Stripe customer decides
  the account; a new customer is linked only to an account without one, the
  one Checkout named. A price this deployment does not know grants nothing,
  and an old subscription ending never overwrites a newer live one.
- Outside production `CAPTURE_TEST_STRIPE_BASE_URL` sends the SDK to the local
  stand-in in `tests/anthropic-stub.mjs`. `tests/billing.test.mjs` covers the
  mapping; `tests/30-signup-billing.spec.ts` pays, redelivers, forges, fails a
  card past its grace, cancels and tries someone else's customer.

## Account classification

- Preserve `User.role` (`admin` / `recruiter`) as the administrative boundary.
  `User.accountTier` is what an administrator granted: `lite`, `basic`
  (default), `pro`, `promax` or `trial` with a UTC `trialExpiresAt`.
  `User.signupSource` is `admin` (default; every account made before self-serve)
  or `self`. Never infer privileges from a name or email. Tier management cannot
  grant/revoke Admin.
- `lib/account-tiers.ts` computes the effective plan on every request, in one
  order: Admin; a Stripe subscription that is active, trialing, or past due for
  under seven days; a trial strictly before its expiry; a plan an administrator
  granted; then, for an account an administrator made, Basic (so beta accounts
  keep exactly what they had), and for a self-serve one, `none`. No scheduled
  job, no data write. The stored values remain for history; do not authorize by
  a raw column or cache an entitlement in a session or browser.
- `none` is the account's own read-only workspace: `getWorkspace()` returns
  `readOnly` and `noPlan`, every `requireWritableWorkspace` refuses with
  `NO_PLAN_MESSAGE`, and the page fieldsets disable as for an administrator's
  view. It still reads what Lite has, exports, deletes itself and reaches
  `/billing` (`requireOwnAccount`); the shell says the trial has ended. Booking
  and client links already sent keep working.
- `FEATURE_TIERS` (`lib/features.ts`) follows the homepage: Lite has the
  pipeline, outreach, booking, client links and follow-up runs (`LITE_FOLLOWUP_RUN_LIMIT`
  people a run); Basic adds the talent database (people search, matches,
  Instant Match, revisit reminders, import) and screening; Pro adds the client
  email and reply suggestions. A trial is Pro. Custom shortlists are limited
  below Pro. Monthly AI allowances are `MONTHLY_QUOTAS` per plan (screening
  Basic 30, Pro 120, Pro Max 300, trial 10); the `CAPTURE_*_MONTHLY_CAP`
  variables only lower them.
- Only Admin in their own writable workspace can create classified accounts or
  change tiers. Trial requires an explicit future UTC expiry. Changes are audited
  transactionally, clear obsolete expiry, and never change business ownership,
  administrator roles, passwords or extension activation.
- Future Pro-only UI must be omitted for Basic, not teased or merely disabled.
  Use `canUseProFeatures` on server-authorized accounts; protect direct page reads
  with `requireProWorkspace` and mutations with `requireWritableProWorkspace` in
  `lib/feature-access.ts`. Both actor and owner must qualify, so read-only Admin
  viewing Basic sees the Basic workspace; viewing Pro never permits writes.
  Check API entitlements server-side too; hiding a link is not authorization.
- Apply the additive `20260918000000_account_tiers` PostgreSQL migration before
  serving this version, only with explicit target/deployment approval. Existing
  local account databases also need an approved additive schema update; builds
  and tests must not migrate real databases. Multi-account imports preserve tier
  and Trial expiry; older snapshots without these fields default to Basic.
- `/admin` is a minimal account directory showing only name, email and effective
  type. Creation lives at `/admin/new`; all per-account status, management actions
  and target-scoped audit history live at `/admin/[id]`. Every route independently
  requires Admin; missing detail IDs return 404. Read-only views retain guards.
- Creation stays on its form to show the one-time setup link, with a separate
  Manage account link. Never redirect away before the admin can copy the secret.
  Key detail forms by account identity so secret state cannot carry across accounts.
  Account and extension mutations must refresh their affected detail route too.
- `tests/account-tiers.test.mjs` covers tier/expiry boundaries and action/feature
  guards; `tests/08-account-tiers.spec.ts` covers UI, live-session changes and
  forged requests using only disposable test accounts/databases.

## Extension activation and downloads

- The extension comes with every plan and the trial; the activation code is
  retired. `canUseExtension` (`lib/extension-access.ts`) is an active account
  with a plan, or an administrator. Downloading, generating a capture key and
  both capture API methods all ask it, so a key stops working the moment its
  plan does and works again with a new one. A forwarded ZIP holds no key and no
  account: it saves nothing for whoever installs it until they have a plan of
  their own, and a key works only for its own workspace. Read-only views cannot
  download; account disabling still revokes sessions and capture keys.
- `ExtensionAccess` stays in the schema (dropping it would be its own approved
  migration) and nothing reads or writes it. The ZIP may be downloaded again;
  capture keys remain separate and are generated in Settings. No personal
  secrets are packaged.
- `/api/extension/download` is authenticated, private/no-store and serves only five
  allowlisted extension files. Shared packaging in `lib/extension-package.mjs`
  uses the configured APP_ORIGIN (exact HTTPS host or local development loopback).
  Never move ZIPs into public/ or trust a request-supplied workbench origin.
- Installation still requires desktop Chrome Developer mode / Load unpacked. No
  silent installation or automatic unpacked-extension updates are promised.
- The popup and the side panel are one file, `popup.html`, opened twice. The
  panel is opened only from a click, at `popup.html#panel`, and recognises itself
  by that fragment or by the absence of a popup context. Never give the panel a
  capability the popup lacks, and never let it read a page without a click: its
  only extra permission is `sidePanel`. Because the panel outlives the page it
  read, it watches `tabs.onActivated`/`onUpdated` (no `tabs` permission, no URL
  access) and, when the tab it read moves, refills from a permitted read or
  clears the page-derived fields and asks for one. A stale profile must never
  sit under a new page, and a typed note is never discarded by a refused read.
- The panel follows the recruiter only if they let it. `activeTab` is taken back
  when a tab navigates to another origin, which is why every profile used to
  need a toolbar click; the optional LinkedIn origin removes that click. The
  panel still tries the page first either way, because `activeTab` survives a
  same-origin move. Without the permission the old behaviour is unchanged:
  the fields clear and it asks for a click. A Pause control stops the reading
  without closing the panel, stored as `autoRead`; refusing the permission is a
  supported answer and must stay one.
- A page that is not a profile - a search result list, an inbox - is a quiet
  wait in the panel, not an error. While following, most pages are not profiles.
- LinkedIn moves between profiles without loading a page: the address names
  the next person before the heading, title and Message link do. So the panel
  re-reads on a new address, a new title or a finished load in the tab it
  read, one read at a time, and treats a profile as half drawn when the heading
  and the title disagree or a new address still carries the last person's
  name. A half-drawn page fills only the address and empties the rest; it is
  looked at again at most three times, 700 ms apart, for that one page and only
  after the move, then handed back to Read this profile. That is a bounded
  second look at the page already open, not polling. A later read of the same
  address replaces only fields still as they were filled, never a corrected
  name or the note, and the member id is always the page's own.
- After a profile is read, the panel asks the workbench (never LinkedIn) whether
  this account already has that person, with `GET /api/capture?profileUrl=`.
  It is scoped to the account's own candidates and returns `existing: null` for
  anyone else's. It reports rather than refuses: filing the same person against
  a second role is the recruiter's decision, and the save keeps its own
  same-role duplicate guard. A failed lookup is silent.
- `lib/extension-package.mjs` pins the permission list exactly, so any change to
  it is a deliberate, reviewed edit in the packager, its tests and this file.
- Deploy the additive `20260910000000_extension_access` PostgreSQL migration before
  serving the new app. Do not edit the old initial migration or apply changes to
  real local/hosted databases without approval. Builds do not apply migrations.
- `tests/07-extension-access.spec.ts` covers a plan ending and returning, download,
  forged requests, API permissions and read-only views. Unit tests cover the
  plan rule and ZIPs.

## Setup and migration safety

- `.env.example` describes a NEW local account database. Do not overwrite an
  existing `.env` or point the new schema at legacy dev.db without a migration plan.
- `APP_ORIGIN` must equal the actual browser origin, including the port. It is
  required in production and must be HTTPS except for loopback development.
- `ANTHROPIC_API_KEY` is server-side and only needed for briefing generation.
  A key not scoped to a workspace also needs `ANTHROPIC_WORKSPACE_ID`, sent as
  the `anthropic-workspace-id` header by every client through
  `lib/anthropic-client.mjs`; create any new Anthropic client with it.
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
- Demo workspace: `scripts/seed-demo.mjs --origin <ORIGIN> --output
  <NEW_PRIVATE_FILE>` against a local SQLite `DATABASE_URL` only (it refuses
  PostgreSQL). It adds one Pro account with no password, three fictional roles
  with briefings and budgets, and fifteen fictional candidates covering every
  stage, a booked call today and next week, a screening with a missing quote,
  submitted candidates, a due reminder, stale facts, do not contact and one
  person on two roles, all dated from the day it runs (`demoPlan`, checked in
  `tests/talent.test.mjs`). The one-time sign-in link goes only to the new
  file; a second run on the same database is refused and adds nothing.
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
- Columns added after the first multi-account databases existed are listed in
  `lateColumns` in `scripts/import-accounts.mjs` (account tiers, and a saved
  search's `searchUrl`). A source from before a group has none of that group's
  columns and imports with the stated defaults; a source with part of a group is
  refused, not guessed at. Add any future column there, with a test for both the
  old and the current shape, or the importer will reject current databases.
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
- Current deployment: `https://retrivr.app` (the Render service
  `capture-workbench`, with the domain's DNS at Cloudflare, DNS only). `APP_ORIGIN`
  must match it exactly, because `/api/extension/download` packages the extension
  for that origin and a mismatch ships a package Chrome will not let reach the site.
- It moved there from `https://capture-workbench.onrender.com`, which Render still
  serves. `middleware.ts` sends a page asked for at any host but `APP_ORIGIN`'s to
  the same path there with a 308 (`lib/canonical-host.mjs`, HTTPS origins only, so
  loopback development is untouched), because booking and client links already
  sent name the old host and their signatures do not cover it. `/api` is not
  redirected, so extensions packaged for the old host (1.2.2 and earlier) keep
  saving until they are replaced; release `2026-10-19.3` asks for the new copy.
  Keep the onrender.com address serving until links sent from it have expired
  (60 days for a shortlist) and no old extension is in use.
- The source extension is built for that deployment: it is in `host_permissions`,
  in the popup CSP and in `WORKBENCH_ORIGINS`, so an unpackaged build offers a
  workbench that exists. Host access is still loopback plus exactly one workbench
  host, and a package replaces the default rather than adding to it. Change all
  three together, and never widen either list to a wildcard.
- A free instance sleeps when idle. The extension allows 60s for an HTTPS
  workbench (10s for loopback) and reads 502/503/504 as "not ready", so a
  cold start does not present as a dead server. Do not shorten that deadline.
- The current service auto-deploys from `origin/main`. Apply and verify approved
  additive database migrations before pushing a version that requires them.
- The current Render database is on the Free plan: dashboard backup exports and
  point-in-time recovery are unavailable. Use a private PostgreSQL custom-format
  dump and verify a restore into an isolated disposable database before an
  authorized migration; do not upgrade paid resources without explicit approval.
- On 2026-09-18, `20260918000000_account_tiers` was applied and registered on the
  current hosted database, with a verified restore rehearsal and unchanged old
  table contents. Local `prisma/accounts.db` received the equivalent additive
  columns and its missing ExtensionAccess table. Both schemas were verified.
  Backups, verification reports and the private migration connection file remain
  under ignored, ACL-protected `prisma/private-local/`; never stage that directory.
  The local database is an older, separate workspace, not a mirror to sync over
  the hosted data. Recheck live migration state before future operations.
- On 2026-09-21, `20260921000000_saved_search_url` was applied and registered the
  same way, on the hosted database and on the local account database, each after
  its own backup and restore rehearsal. The feature it was for was reverted and has
  since returned, so both schemas declare `searchUrl` again and no second
  migration was written for it - the column was already applied everywhere. Keep the migration directory: deleting it would leave an applied
  migration with no local counterpart and `db:deploy:hosted` would refuse to run.
  Never edit its SQL either - its checksum is recorded in `_prisma_migrations`,
  and any change to the file fails verification. To retire the column, drop it and its `_prisma_migrations` row as its own approved,
  backed-up operation. The run's dump and reports are in `prisma/private-local/`.

- On 2026-09-22, `20260922000000_candidate_member_id` was applied and registered
  on the hosted database the same way: preflight identity/TLS check, a
  custom-format dump restored into a disposable container, the migration
  rehearsed there against unchanged table contents, then one transaction on the
  hosted database with the same verification. All 19 existing candidates came
  out with a null `memberId`, as an additive nullable column must. The local
  account database received the equivalent column. The dump and the two reports
  are in ignored `prisma/private-local/`, alongside the run script.
- On 2026-10-01, `20261005000000_talent_database` (people, screenings,
  bookings, usage, suppressions; role budget, candidate `personId`, booking
  settings) was applied and registered on the hosted database the same way,
  checked against the reviewed file's SHA-256. All 33 existing candidates came
  out with a null `personId` and every new table empty; linking them to people
  is the separate `scripts/backfill-people.mjs` step. The local account
  database received the equivalent change as in-place `ADD COLUMN`s rather
  than Prisma's SQLite table rebuild, rehearsed on a copy first; Prisma then
  reports no difference from the schema. The SQL, the backup copy, the dump
  and the reports are in ignored `prisma/private-local/`.
- On 2026-10-05, `20261006000000_person_notes_integrations` (`PersonNote`,
  `IntegrationConnection`) was applied and registered on the hosted database
  the same way: preflight identity/TLS and migration-state check, a
  custom-format dump restored into a disposable container and the migration
  rehearsed there, then one transaction checked against the reviewed file's
  SHA-256. Every existing table came out unchanged and both new tables empty;
  Prisma reports 8 migrations and no difference. The local account database
  received the same two `CREATE TABLE`s in place after a backup copy and a
  rehearsal on another copy, with every existing table's content unchanged.
  The scripts, dump, copies and reports are in ignored `prisma/private-local/`.
- On 2026-10-14, `20261015000000_import_batches` (`ImportBatch`, nullable
  `importBatchId` on Person, Role and Candidate) was applied and registered on
  the hosted database the same way, checked against the reviewed file's
  SHA-256. Docker Desktop would not start on this Windows build, so the
  PostgreSQL 17 tools and the disposable rehearsal database ran in WSL Ubuntu
  from the official PGDG packages instead (`prisma/private-local/verify-db.sh`:
  a fresh /tmp directory, a Unix socket and no network address, deleted
  afterwards). The first attempt lost its connection before the backup and
  committed nothing; the second committed. Every existing table came out
  unchanged, the new table empty and no row with a batch; Prisma reports 9
  migrations and no difference. Prisma's connection to the hosted database
  needed `connect_timeout=30` from this machine. The local account database
  received the table and the three columns in place (`ADD COLUMN`, not Prisma's
  SQLite rebuild) after a backup copy and a rehearsal, every existing table's
  content unchanged and Prisma reporting no difference.
- On 2026-10-18, `20261020000000_client_shortlists` (`Shortlist`,
  `ShortlistItem`, `ShortlistAccess`, `InterviewSlot`; the role's client
  review switch and interview hours, `Candidate.submittedAt`, `Booking.kind`)
  was applied and registered on the hosted database the same way, through
  WSL as on 2026-10-14 (`prisma/private-local/migrate-hosted-client-shortlists.mjs`),
  checked against the reviewed file's SHA-256: a custom-format dump from a
  locked snapshot, restored into a disposable database and rehearsed, then one
  transaction. Every existing table came out unchanged, the four new tables
  empty, every role reviewing first with no interview hours, no candidate
  submitted and every booking a screening call; Prisma reports 10 migrations
  and no difference. Deploying the code also needs `SHORTLIST_LINK_SECRET` on
  the service. The local account database has not received this migration.
- On 2026-10-18, `20261021000000_client_notifications` (`Notification`) was
  applied and registered on the hosted database the same way, through WSL
  (`prisma/private-local/migrate-hosted-client-notifications.mjs`), checked
  against the reviewed file's SHA-256: a dump from a locked snapshot, restored
  into a disposable database and rehearsed, then one transaction. Every
  existing table came out unchanged and the new table empty; Prisma reports 11
  migrations and no difference. The local account database has not received
  it.
- On 2026-10-19, `20261022000000_interview_offers` (`InterviewOffer`; nullable
  `Booking.place` and `timeZone`) was applied and registered on the hosted
  database the same way, through WSL
  (`prisma/private-local/migrate-hosted-interview-offers.mjs`), checked against
  the reviewed file's SHA-256: a dump from a locked snapshot, restored into a
  disposable database and rehearsed, then one transaction. Every existing
  table came out unchanged, the new table empty and no booking with a place
  or zone; Prisma reports 12 migrations and no difference. The local account
  database has not received it.
- On 2026-10-19, `20261023000000_person_cv` (`PersonCv`) was applied and
  registered on the hosted database the same way, through WSL
  (`prisma/private-local/migrate-hosted-person-cv.mjs`), checked against the
  reviewed file's SHA-256: a dump from a locked snapshot, restored into a
  disposable database and rehearsed, then one transaction. Every existing
  table came out unchanged and the new table empty; Prisma reports 13
  migrations and no difference. The local account database has not received
  it.
- On 2026-10-20, `20261024000000_self_serve_accounts` (fourteen sign-up and
  billing columns on `User`; `AuthSession`, `AuthAccount`, `AuthVerification`,
  `PendingSignup`, `TrialClaim`, `StripeEvent`) was applied and registered on
  the hosted database the same way, through WSL
  (`prisma/private-local/migrate-hosted-self-serve.mjs`, which logs account
  counts only, never names or emails), checked against the reviewed file's
  SHA-256: a dump from a locked snapshot, restored into a disposable database
  and rehearsed, then one transaction. Every existing table came out unchanged,
  the six new tables empty, and all five accounts `signupSource` `admin` with
  no billing, terms or verified email, so each keeps what it had; Prisma
  reports 14 migrations and no difference. The local account database has not
  received it. Sign-up and billing stay closed until `BETTER_AUTH_SECRET`,
  `TERMS_URL`, `PRIVACY_URL`, `TERMS_VERSION`, `RESEND_API_KEY`, `MAIL_FROM`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the `STRIPE_PRICE_*` ids
  are set on the service.

## Searches and LinkedIn industry filters

- Of the three LinkedIn search surfaces, only two carry their filters in the
  address. Classic `/search/results/people/` takes facet lists of LinkedIn's own
  ids (`industry=["25"]`); Sales Navigator serialises its whole filter tree.
  **Recruiter `/talent/search` carries only opaque ids** - `searchContextId`,
  `searchHistoryId`, `searchRequestId` - and keeps the filters server side, so
  industries cannot be written into a Recruiter address from out here. Do not
  add code that pretends otherwise.
- `lib/linkedin-industries.json` is LinkedIn's published industries-v2 taxonomy,
  vendored: 434 active entries with the id its filters use, its exact label and
  the hierarchy path. LinkedIn's deprecated ("Inactive Nodes") entries are
  deliberately excluded. Nothing fetches this at runtime; it changes only when
  someone regenerates the file from LinkedIn's reference table.
- `lib/linkedin-industries.ts` matches a recruiter's own wording against that
  table over label, hierarchy path and a small alias list (pharma, logistics,
  fintech and the like). `components/IndustryPicker.tsx` stores only entries
  LinkedIn recognises, as `{id,label}` in the existing `industries` JSON column.
  Free text saved before the picker stays readable and is offered real matches
  on edit; it has no id, so it cannot reach a URL. Keep `parseIndustries`
  tolerant of both shapes rather than migrating the column.
- `RunSearchButton` opens a saved LinkedIn link when there is one, otherwise a
  classic search with the picked industry ids already applied. Industry labels
  also get a copy control, because pasting them into Recruiter's own filter is
  the only way industries reach Recruiter.
- `SavedSearch.searchUrl` is never asked for up front. It is offered once a
  search has been run before, saved through `attachSearchLink`, and can be
  edited or cleared afterwards on the edit form. The address stays opaque: it is
  validated as an HTTPS linkedin.com `/talent/` or `/search/` address and opened
  on a click, never parsed, rewritten, kept in step with the industry table, or
  requested.
- Automating LinkedIn's own filter controls is out of bounds, from the app and
  from the extension alike. It is the one part of this that would put the
  recruiter's account at risk, and the saved link plus the copy control exist so
  it is never needed.

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
`activeTab`, `scripting`, `sidePanel`, `storage`, no content scripts/background, granted
host access limited to loopback plus the packaged workbench host, and
`optional_host_permissions` exactly `["https://*.linkedin.com/*"]` - optional, never
granted by the package. Run unit and account-isolation
regressions, including foreign IDs, read-only admin views and revoked capture keys.
