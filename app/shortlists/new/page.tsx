import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { activeShortlistLimit } from "@/lib/features";
import { consentPersonSelect, knownConsentAt } from "@/lib/shortlists";
import { defaultShortlistTitle, shortlistStatus } from "@/lib/shortlist-core.mjs";
import { addToShortlist, createShortlist } from "@/app/actions/custom-shortlists";
import { ActionForm } from "@/components/ActionForm";
import { NoCvGuard } from "@/components/NoCvGuard";

export const dynamic = "force-dynamic";

// Putting a shortlist together, or adding to one. Who is on it and which
// client it is for travel in the address (p, client), so a search, the
// People list, a person's page or a role can each start it with people
// already chosen. The client is settled before anything is saved, so whether
// each person agreed to be put forward is worked out for that client.

type Params = { p?: string | string[]; q?: string; client?: string; add?: string };

const MAX_PEOPLE = 50;
const RESULTS = 30;

function list(value: string | string[] | undefined) {
  return Array.from(new Set((Array.isArray(value) ? value : value ? [value] : []).filter((id) => /^[a-z0-9]{8,40}$/.test(id)))).slice(0, MAX_PEOPLE);
}

function hrefWith(params: { p: string[]; client: string; q?: string; add?: string }) {
  const search = new URLSearchParams();
  for (const id of params.p) search.append("p", id);
  if (params.client) search.set("client", params.client);
  if (params.q) search.set("q", params.q);
  if (params.add) search.set("add", params.add);
  return `/shortlists/new?${search.toString()}`;
}

export default async function NewShortlistPage({ searchParams }: { searchParams: Params }) {
  const { owner, readOnly } = await requireFeature("clientShortlists");
  const now = new Date();
  const adding = searchParams.add
    ? await db.shortlist.findFirst({ where: { id: searchParams.add, userId: owner.id, kind: "custom" }, include: { items: { select: { personId: true } } } })
    : null;
  const lastClient = adding ? null : await db.shortlist.findFirst({ where: { userId: owner.id, kind: "custom" }, orderBy: { createdAt: "desc" }, select: { client: true } });
  const client = (adding?.client ?? searchParams.client ?? lastClient?.client ?? "").trim().slice(0, 120);
  const chosenIds = list(searchParams.p).filter((id) => !adding?.items.some((item) => item.personId === id));
  const q = (searchParams.q ?? "").trim().slice(0, 80);

  const [chosenRows, found, active] = await Promise.all([
    db.person.findMany({ where: { id: { in: chosenIds }, userId: owner.id }, select: { id: true, fullName: true, headline: true, ...consentPersonSelect, cv: { select: { uploadedAt: true } } } }),
    q
      ? db.person.findMany({
          where: { userId: owner.id, doNotContact: false, searchText: { contains: q.toLowerCase() }, id: { notIn: [...chosenIds, ...(adding?.items.map((item) => item.personId) ?? [])] } },
          orderBy: { updatedAt: "desc" },
          take: 200,
          select: { id: true, fullName: true, headline: true },
        })
      : Promise.resolve([]),
    db.shortlist.count({ where: { userId: owner.id, kind: "custom", revokedAt: null, expiresAt: { gt: now } } }),
  ]);
  const byId = new Map(chosenRows.map((person) => [person.id, person]));
  const chosen = chosenIds.map((id) => byId.get(id)).filter((person): person is (typeof chosenRows)[number] => Boolean(person));
  const needle = q.toLowerCase();
  // Searched by name and headline only, on every plan, as People does without
  // people search.
  const results = found.filter((person) => `${person.fullName} ${person.headline ?? ""}`.toLowerCase().includes(needle)).slice(0, RESULTS);
  const limit = activeShortlistLimit(owner, now);
  const atLimit = !adding && limit !== null && active >= limit;
  const addingClosed = adding && shortlistStatus(adding, null, now) !== "active";
  const keep = chosen.map((person) => person.id);
  const blocked = chosen.filter((person) => person.doNotContact);

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
      <header className="page-header">
        <div>
          <h1>{adding ? `Add to ${adding.title}` : "New shortlist"}</h1>
          <p className="page-description">
            {adding
              ? `People you add appear on the same page ${adding.client || "the client"} already has.`
              : "A page of people you would like one client to meet, which they open without signing in. It stays open for 60 days unless you keep it open longer."}
          </p>
        </div>
        {adding
          ? <Link href="/shortlists" className="btn-quiet">Back to shortlists</Link>
          : <Link href="/people" className="btn-quiet">Back to People</Link>}
      </header>

      {!adding && limit !== null && (
        <p className={`shortlist-limit${atLimit ? " is-full" : ""}`} role={atLimit ? "alert" : undefined}>
          <strong className="tabular">{active} of {limit}</strong> active shortlists on your plan.
          {atLimit && <> Close one, or let one expire, on <Link href="/shortlists" className="underline">Shortlists</Link> to open another. Links you already sent keep working.</>}
        </p>
      )}

      <form method="get" className="shortlist-picker">
        {adding && <input type="hidden" name="add" value={adding.id} />}
        {keep.map((id) => <input key={id} type="hidden" name="p" value={id} />)}
        {!adding && (
          <div>
            <label htmlFor="shortlist-client" className="field-label">For which client</label>
            <input id="shortlist-client" name="client" defaultValue={client} required maxLength={120} className="field-input" placeholder="Halden Systems" />
          </div>
        )}
        <div>
          <label htmlFor="shortlist-find" className="field-label">Find people by name or headline</label>
          <div className="flex flex-wrap gap-2">
            <input id="shortlist-find" name="q" type="search" defaultValue={q} className="field-input flex-1" placeholder="Name or headline" />
            <button type="submit" className="btn-secondary">{adding ? "Find" : "Find and update"}</button>
          </div>
        </div>
        {q && (
          <div>
            {results.length === 0 ? (
              <p className="section-caption">No one else in your people matches that.</p>
            ) : (
              <>
                <ul className="shortlist-results" aria-label="People found">
                  {results.map((person) => (
                    <li key={person.id}>
                      <label>
                        <input type="checkbox" name="p" value={person.id} />
                        <span className="font-medium">{person.fullName}</span>
                        {person.headline && <span className="text-ink-soft">{person.headline}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
                <button type="submit" className="btn-secondary mt-3">Add ticked people</button>
              </>
            )}
          </div>
        )}
      </form>

      <section aria-labelledby="chosen-heading" className="space-y-4">
        <h2 id="chosen-heading" className="section-heading">
          {adding ? "Adding" : "On this shortlist"} <span className="person-count tabular">{chosen.length}</span>
        </h2>
        {chosen.length === 0 ? (
          <p className="text-ink-soft">
            No one yet. Find people above by name or headline.
          </p>
        ) : !client ? (
          <p className="text-ink-soft">Say which client this is for, then press Find and update, so Capture can check who already agreed to be put forward to them.</p>
        ) : (
          <ActionForm action={adding ? addToShortlist : createShortlist} className="space-y-5">
            {adding ? <input type="hidden" name="shortlistId" value={adding.id} /> : <input type="hidden" name="client" value={client} />}
            <ul className="shortlist-chosen">
              {chosen.map((person) => {
                const known = knownConsentAt(person, "", client);
                const without = keep.filter((id) => id !== person.id);
                return (
                  <li key={person.id}>
                    <input type="hidden" name="p" value={person.id} />
                    <div className="min-w-0">
                      <Link href={`/people/${person.id}`} className="person-row-name">{person.fullName}</Link>
                      {person.headline && <p className="person-row-headline">{person.headline}</p>}
                    </div>
                    <div className="shortlist-consent">
                      {!person.cv && !person.doNotContact && <span className="chip no-cv-chip">No CV</span>}
                      {person.doNotContact ? (
                        <span className="chip person-flag">Do not contact</span>
                      ) : known ? (
                        <span className="chip screening-chip-done">Agreed before to {client}</span>
                      ) : (
                        <label>
                          <input type="checkbox" name="agreed" value={person.id} required />
                          <span>Agreed to be put forward to {client}</span>
                        </label>
                      )}
                      <Link href={hrefWith({ p: without, client, q, add: adding?.id })} className="btn-quiet">Remove</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!adding && (
              <div>
                <label htmlFor="shortlist-title" className="field-label">Name (optional)</label>
                <input id="shortlist-title" name="title" maxLength={120} className="field-input" placeholder={defaultShortlistTitle(client, now)} />
              </div>
            )}
            {blocked.length > 0 && <p role="alert" className="text-sm text-rose-900">Take anyone marked do not contact off the list before saving.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <NoCvGuard
                className="btn-primary"
                disabled={atLimit || Boolean(addingClosed) || blocked.length > 0}
                label={adding ? `Add ${chosen.length === 1 ? "them" : `these ${chosen.length}`}` : "Create shortlist"}
                client={client}
                missing={chosen.filter((person) => !person.cv && !person.doNotContact).map((person) => ({ name: person.fullName, personId: person.id }))}
              />
              {addingClosed && <span className="text-sm text-ink-soft">This shortlist is closed or has expired. Keep it open on Shortlists first.</span>}
            </div>
          </ActionForm>
        )}
      </section>
    </fieldset>
  );
}
