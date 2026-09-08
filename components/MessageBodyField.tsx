"use client";

import { useState } from "react";
import { CONNECTION_NOTE_LIMIT, TEMPLATE_KINDS, templateKindLabel } from "@/lib/templates";

// The body field and the kind that governs it, together, because the length
// that matters depends on which door the message goes through. The count is
// of the template text; placeholders will grow or shrink it when it is
// rendered for a real candidate, which the preview says out loud.
export function MessageBodyField({
  idPrefix,
  bodyId,
  defaultKind = "message",
  defaultBody = "",
  bodyRows = 6,
  placeholder,
}: {
  idPrefix: string;
  // Overridable so a caller can keep an established field id.
  bodyId?: string;
  defaultKind?: string;
  defaultBody?: string;
  bodyRows?: number;
  placeholder?: string;
}) {
  const [kind, setKind] = useState(defaultKind);
  const [body, setBody] = useState(defaultBody);

  const bodyFieldId = bodyId ?? `${idPrefix}-body`;
  const limit = kind === "connection_note" ? CONNECTION_NOTE_LIMIT : null;
  const over = limit !== null && body.length > limit;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-kind`} className="field-label">
          Sent as
        </label>
        <select
          id={`${idPrefix}-kind`}
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="field-input"
        >
          {TEMPLATE_KINDS.map((value) => (
            <option key={value} value={value}>
              {templateKindLabel(value)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-ink-soft">
          {kind === "connection_note"
            ? `Goes out with an invitation, so LinkedIn caps it at ${CONNECTION_NOTE_LIMIT} characters.`
            : "Sent once you are connected. No length limit worth worrying about."}
        </p>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor={bodyFieldId} className="field-label">
            Message
          </label>
          <span
            className={`font-mono text-xs tabular ${over ? "text-rose-900" : "text-ink-soft"}`}
            aria-live="polite"
          >
            {limit === null ? `${body.length} characters` : `${body.length} / ${limit}`}
          </span>
        </div>
        <textarea
          id={bodyFieldId}
          name="body"
          required
          rows={bodyRows}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="field-input"
          placeholder={placeholder}
          aria-describedby={over ? `${idPrefix}-over` : undefined}
        />
        {over && (
          <p id={`${idPrefix}-over`} role="alert" className="mt-1 text-sm text-rose-900">
            {body.length - limit!} characters over the connection-note limit. Trim it, or
            change &ldquo;Sent as&rdquo; to Message.
          </p>
        )}
      </div>
    </div>
  );
}
