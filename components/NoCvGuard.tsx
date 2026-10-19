"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CvUpload } from "@/components/CvUpload";
import { missingCvMessage } from "@/lib/cv-core.mjs";

type Missing = { name: string; personId?: string | null; candidateId?: string | null };

// A submit button that puts people in front of a client. When any of them has
// no CV it stops first and says so: the client will see only the confirmed
// details. With one person the CV can be uploaded right there (with its
// contact-details check), after which the button goes ahead by itself; or
// "Skip for now" goes ahead without it, because a CV often comes later.
// The dialog sits outside the form it guards, since forms cannot nest.
export function NoCvGuard({ missing, client, label, className = "btn-quiet", disabled = false }: {
  missing: Missing[];
  client: string;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const proceed = useRef(false);
  const [open, setOpen] = useState(false);
  // One dialog per button on a page of rows: each needs its own title id.
  const titleId = useId();
  // Who was missing when the question was asked: an upload from the dialog
  // refreshes the page, and the dialog must not lose its own upload form to it.
  const [asked, setAsked] = useState<Missing[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const go = () => {
    proceed.current = true;
    setOpen(false);
    button.current?.form?.requestSubmit(button.current);
  };
  const one = asked.length === 1 ? asked[0] : null;
  const first = one ? one.name.trim().split(/\s+/)[0] : null;

  return (
    <>
      <button
        ref={button}
        type="submit"
        className={className}
        disabled={disabled}
        onClick={(event) => {
          if (missing.length === 0 || proceed.current) {
            proceed.current = false;
            return;
          }
          event.preventDefault();
          // The form's own checks (a required tick) come before the question.
          if (button.current?.form && !button.current.form.reportValidity()) return;
          setAsked(missing);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {mounted && createPortal(
        <dialog ref={dialog} className="no-cv-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)}>
          <div className="no-cv-dialog-body">
            <h2 id={titleId} className="no-cv-dialog-title">{one ? `No CV for ${first} yet` : `No CV for ${asked.length} of them yet`}</h2>
            <p className="text-sm">{missingCvMessage(asked.map((person) => person.name), client)}</p>
            {one && (one.personId || one.candidateId) && open && (
              <CvUpload
                personId={one.personId ?? undefined}
                candidateId={one.personId ? undefined : one.candidateId ?? undefined}
                idPrefix="no-cv-upload"
                label={`Upload and continue`}
                onUploaded={go}
              />
            )}
            <div className="no-cv-dialog-actions">
              <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn-secondary" onClick={go}>Skip for now</button>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
