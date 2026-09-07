"use client";

import { useState, useTransition } from "react";
import { clearCaptureToken, regenerateCaptureToken } from "@/app/actions/settings";
import { CopyButton } from "@/components/CopyButton";

// The key is shown rather than hidden: it only lets someone add candidates to
// this workbench while it is running on this machine, and it is useless to
// anyone who cannot reach localhost. Hiding it would just mean Paul cannot
// paste it into the extension.
export function CaptureKeyPanel({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const run = (action: () => Promise<{ notice?: string; error?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.notice ?? result.error ?? null);
    });
  };

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-lg">Browser extension</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The capture extension saves a profile you already have open. It reads that page
          only when you click it, and it needs this key to reach this workbench.
        </p>
      </div>

      {token ? (
        <>
          <div>
            <span className="field-label">Capture key</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded border border-line bg-sunken px-3 py-2 font-mono text-sm">
                {revealed ? token : "•".repeat(Math.min(token.length, 32))}
              </code>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setRevealed((was) => !was)}
              >
                {revealed ? "Hide" : "Show"}
              </button>
              <CopyButton text={token} label="Copy key" className="btn-secondary" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(regenerateCaptureToken)}
            >
              Generate a new key
            </button>
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(clearCaptureToken)}
            >
              Switch capture off
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => run(regenerateCaptureToken)}
          >
            Generate a capture key
          </button>
          <span className="text-sm text-ink-soft">Capture is currently switched off.</span>
        </div>
      )}

      {message && (
        <p role="status" data-form-message="notice" className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink">
          {message}
        </p>
      )}
    </div>
  );
}
