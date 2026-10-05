"use client";

import { useEffect, useRef, useState } from "react";
import { NotionLogo } from "@/components/NotionLogo";

export type NotionState = { configured: boolean; connected: boolean; workspace: string; outcome: string | null };
type Page = { id: string; title: string; editedAt: string };

const edited = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

// "Import from Notion": the recruiter picks one of the pages they shared with
// Capture, and its text lands in the box for them to read before anything is
// summarised or saved. Before the first import it is "Connect Notion", which
// goes through Notion's own sign-in and page picker.
export function NotionImport({ state, returnTo, onImport }: { state: NotionState; returnTo: string; onImport: (page: { title: string; text: string; cut: boolean }) => void }) {
  const [open, setOpen] = useState(state.connected && state.outcome === "connected");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<Page[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; reconnect: boolean } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const connectHref = `/api/notion/connect?return=${encodeURIComponent(returnTo)}`;

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/notion/pages?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as { pages?: Page[]; error?: string; reconnect?: boolean };
        if (!response.ok || !body.pages) {
          setError({ text: body.error ?? "Notion could not be reached. Try again in a moment.", reconnect: Boolean(body.reconnect) });
          setPages([]);
          return;
        }
        setError(null);
        setPages(body.pages);
      } catch {
        if (!controller.signal.aborted) setError({ text: "Notion could not be reached. Try again in a moment.", reconnect: false });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  async function choose(page: Page) {
    setLoading(page.id);
    setError(null);
    try {
      const response = await fetch(`/api/notion/pages/${encodeURIComponent(page.id)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { title?: string; text?: string; cut?: boolean; error?: string; reconnect?: boolean };
      if (!response.ok || typeof body.text !== "string") {
        setError({ text: body.error ?? "That page could not be read from Notion.", reconnect: Boolean(body.reconnect) });
        return;
      }
      onImport({ title: body.title ?? page.title, text: body.text, cut: Boolean(body.cut) });
      setOpen(false);
    } catch {
      setError({ text: "That page could not be read from Notion.", reconnect: false });
    } finally {
      setLoading(null);
    }
  }

  if (!state.configured) return null;

  return (
    <div className="notion-import">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-soft">Or import from</span>
        {state.connected ? (
          <button type="button" className="app-pill" aria-expanded={open} aria-controls="notion-picker" onClick={() => setOpen((value) => !value)}>
            <NotionLogo />
            Import from Notion
          </button>
        ) : (
          <a href={connectHref} className="app-pill">
            <NotionLogo />
            Connect Notion
          </a>
        )}
        {state.outcome === "declined" && <span role="status" className="text-sm text-ink-soft">Notion was not connected.</span>}
        {state.outcome === "failed" && <span role="alert" className="text-sm text-rose-900">Notion could not be connected. Try again.</span>}
      </div>

      {open && state.connected && (
        <div id="notion-picker" className="notion-picker">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="notion-search" className="field-label">
              Your Notion pages{state.workspace ? ` in ${state.workspace}` : ""}
            </label>
            <a href={connectHref} className="text-xs text-ink-soft underline underline-offset-2">Choose which pages Capture can see</a>
          </div>
          <input
            ref={search}
            id="notion-search"
            type="search"
            className="field-input"
            placeholder="Search by page title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          {error && (
            <p role="alert" className="text-sm text-rose-900">
              {error.text}{" "}
              {error.reconnect && <a href={connectHref} className="underline">Connect Notion</a>}
            </p>
          )}
          {pages === null ? (
            <p className="text-sm text-ink-soft">Looking in Notion...</p>
          ) : pages.length === 0 && !error ? (
            <p className="text-sm text-ink-soft">No pages found. Try another word, or let Capture see more pages.</p>
          ) : (
            <ul className="notion-pages" aria-label="Notion pages">
              {pages.map((page) => (
                <li key={page.id}>
                  <button type="button" onClick={() => choose(page)} disabled={loading !== null}>
                    <span className="notion-page-title">{page.title}</span>
                    <span className="text-xs text-ink-soft tabular">
                      {loading === page.id ? "Reading..." : page.editedAt ? `Edited ${edited.format(new Date(page.editedAt))}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
