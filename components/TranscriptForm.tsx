"use client";

import { useRef, useState } from "react";
import { useFormState } from "react-dom";
import { summariseScreening } from "@/app/actions/screening";
import { EMPTY_FORM_STATE } from "@/lib/formState";
import { SubmitButton } from "@/components/SubmitButton";

const LIMIT = 60_000;

// Paste, upload or type, then one click asks for the summary. An uploaded
// transcript is read into the box so the recruiter sees exactly what will be
// sent, and can cut the small talk before it is.
export function TranscriptForm({
  candidateId,
  initialTranscript = "",
  initialSource = "paste",
}: {
  candidateId: string;
  initialTranscript?: string;
  initialSource?: string;
}) {
  const [state, action] = useFormState(summariseScreening, EMPTY_FORM_STATE);
  const [text, setText] = useState(initialTranscript);
  const [source, setSource] = useState(initialSource);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(txt|vtt)$/i.test(file.name)) {
      setFileNote("Upload the .txt or .vtt file your call app saved. For a Word file, copy the text and paste it instead.");
      return;
    }
    setText(await file.text());
    setSource("upload");
    setFileNote(`Read ${file.name}. Check it below, then summarise.`);
    // The text now travels in the box; sending the file as well would double it.
    if (fileInput.current) fileInput.current.value = "";
  }

  const over = text.length > LIMIT;

  return (
    <form action={action} className="screening-form">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="source" value={source} />
      {state.error && (
        <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="transcript" className="field-label">Transcript or notes</label>
        <textarea
          id="transcript"
          name="transcript"
          rows={12}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (source === "upload" && !event.target.value) setSource("paste");
          }}
          className="field-input font-mono text-xs leading-relaxed"
          aria-describedby="transcript-help transcript-count"
        />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
          <p id="transcript-help">Paste it from Meet, Teams or Zoom, or type your own notes.</p>
          <p id="transcript-count" className={`tabular ${over ? "text-rose-900" : ""}`}>
            {text.length.toLocaleString("en-GB")} of {LIMIT.toLocaleString("en-GB")} characters
          </p>
        </div>
      </div>

      <div className="screening-files">
        <div>
          <label htmlFor="transcriptFile" className="field-label">Or upload the transcript file</label>
          <input
            ref={fileInput}
            id="transcriptFile"
            name="transcriptFile"
            type="file"
            accept=".txt,.vtt,text/plain,text/vtt"
            className="screening-file"
            onChange={(event) => readFile(event.target.files?.[0])}
            aria-describedby="transcript-file-help"
          />
          <p id="transcript-file-help" role="status" className="mt-2 text-xs text-ink-soft">
            {fileNote ?? "A .txt or .vtt file, as Meet, Teams and Zoom save them."}
          </p>
        </div>
        <div>
          <label htmlFor="cv" className="field-label">CV (optional)</label>
          <input id="cv" name="cv" type="file" accept="application/pdf,.pdf" className="screening-file" aria-describedby="cv-help" />
          <p id="cv-help" className="mt-2 text-xs text-ink-soft">A PDF of up to 5 pages, read for context only. It is sent with this one request and not kept.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Summarising the call..." disabled={over || !text.trim()}>Summarise</SubmitButton>
        <p className="text-xs text-ink-soft">Usually under a minute. Nothing is saved to their record until you confirm it.</p>
      </div>
    </form>
  );
}
