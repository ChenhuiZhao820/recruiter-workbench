"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { summariseScreening } from "@/app/actions/screening";
import { EMPTY_FORM_STATE } from "@/lib/formState";
import { SubmitButton } from "@/components/SubmitButton";

const LIMIT = 60_000;

// Paste, upload or type, then one click asks for the summary. The box stays
// closed until the recruiter asks for it or uploads a file; an uploaded
// transcript is read into the box so they see exactly what will be sent, and
// can cut the small talk before it is.
export function TranscriptForm({
  candidateId,
  initialTranscript = "",
  initialSource = "paste",
  startOpen = false,
}: {
  candidateId: string;
  initialTranscript?: string;
  initialSource?: string;
  startOpen?: boolean;
}) {
  const [state, action] = useFormState(summariseScreening, EMPTY_FORM_STATE);
  const [text, setText] = useState(initialTranscript);
  const [source, setSource] = useState(initialSource);
  const [open, setOpen] = useState(startOpen || Boolean(initialTranscript));
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  function openBox() {
    setOpen(true);
    requestAnimationFrame(() => box.current?.focus());
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(txt|vtt)$/i.test(file.name)) {
      setFileNote("Upload the .txt or .vtt file your call app saved. For a Word file, copy the text and paste it instead.");
      return;
    }
    setText(await file.text());
    setSource("upload");
    setOpen(true);
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

      {open ? (
        <div>
          <label htmlFor="transcript" className="field-label">Transcript or notes</label>
          <textarea
            ref={box}
            id="transcript"
            name="transcript"
            rows={12}
            value={text}
            placeholder="Paste the transcript from Meet, Teams or Zoom, or type your notes from the call."
            onChange={(event) => {
              setText(event.target.value);
              if (source === "upload" && !event.target.value) setSource("paste");
            }}
            className="field-input font-mono text-xs leading-relaxed"
            aria-describedby="transcript-count"
          />
          <p id="transcript-count" className={`mt-2 text-right text-xs tabular ${over ? "text-rose-900" : "text-ink-soft"}`}>
            {text.length.toLocaleString("en-GB")} of {LIMIT.toLocaleString("en-GB")} characters
          </p>
        </div>
      ) : (
        <button type="button" className="screening-add" onClick={openBox}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add meeting note or transcript
        </button>
      )}

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
          />
          {fileNote && <p role="status" className="mt-2 text-xs text-ink-soft">{fileNote}</p>}
        </div>
        <div>
          <label htmlFor="cv" className="field-label">CV (optional)</label>
          <input id="cv" name="cv" type="file" accept="application/pdf,.pdf" className="screening-file" />
        </div>
        <label className="screening-keep">
          <input type="checkbox" name="discardTranscript" className="mt-0.5" />
          <span>
            <span className="block text-sm text-ink">Don&rsquo;t keep the transcript in Capture</span>
            <span className="block text-xs text-ink-soft">It is deleted as soon as the summary is ready. A CV is never kept.</span>
          </span>
        </label>
      </div>

      <SummariseControls disabled={over || !text.trim()} failed={Boolean(state.error)} />
    </form>
  );
}

// The summary is one request that takes tens of seconds. The bar is an
// estimate paced to that, named by what the request is doing, and never
// reaches the end until the answer is back.
const STAGES: [number, string][] = [
  [0, "Sending the call"],
  [3, "Reading the transcript"],
  [10, "Finding salary, notice, location and right to work"],
  [28, "Checking each fact against a quote from the call"],
  [50, "Nearly there"],
];

function stageAt(seconds: number) {
  return [...STAGES].reverse().find(([from]) => seconds >= from)?.[1] ?? STAGES[0][1];
}

function percentAt(seconds: number) {
  return Math.round(92 * (1 - Math.exp(-seconds / 22)));
}

function SummariseControls({ disabled, failed }: { disabled: boolean; failed: boolean }) {
  const { pending } = useFormStatus();
  // A finished summary keeps the bar full until the page shows the facts,
  // rather than flashing the form back for a moment in between.
  const [done, setDone] = useState(false);
  const wasPending = useRef(false);
  const stageText = useRef<HTMLParagraphElement>(null);
  const secondsText = useRef<HTMLParagraphElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setDone(false);
    } else if (wasPending.current) {
      wasPending.current = false;
      setDone(!failed);
    }
  }, [pending, failed]);

  // The ticking is written straight to the page. Setting React state while
  // the form is pending ends its pending state early in this React version.
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const tick = () => {
      const seconds = (Date.now() - started) / 1000;
      const stage = stageAt(seconds);
      const percent = percentAt(seconds);
      if (stageText.current) stageText.current.textContent = stage;
      if (secondsText.current) secondsText.current.textContent = `${Math.floor(seconds)} s`;
      if (fill.current) fill.current.style.transform = `scaleX(${percent / 100})`;
      track.current?.setAttribute("aria-valuenow", String(percent));
      track.current?.setAttribute("aria-valuetext", stage);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [pending]);

  const busy = pending || done;
  const stage = done ? "Done. Opening the summary" : stageAt(0);
  const percent = done ? 100 : 0;
  // The button stays mounted, hidden, while the bar shows.
  return (
    <div>
      <div hidden={busy}>
        <SubmitButton pendingLabel="Summarising..." disabled={disabled}>Summarise</SubmitButton>
      </div>
      {busy && (
        <div className="screening-progress" aria-live="polite">
          <div className="flex items-baseline justify-between gap-4">
            <p ref={stageText} className="text-sm font-medium text-ink">{stage}</p>
            <p ref={secondsText} className="text-xs tabular text-ink-soft" />
          </div>
          <div
            ref={track}
            className="screening-progress-track"
            role="progressbar"
            aria-label="Summarising the call"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={stage}
          >
            <span ref={fill} style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <p className="text-xs text-ink-soft">
            You can leave this page. The summary carries on and will be waiting here when you come back.
          </p>
        </div>
      )}
    </div>
  );
}
