"use client";

import { useState } from "react";
import { clearCaptureToken, regenerateCaptureToken } from "@/app/actions/settings";
import { CopyButton } from "@/components/CopyButton";

// The key is shown only when generated: the database stores its hash, and it
// belongs to this account rather than whichever website session is open.
// Share it only with the capture extension connected to this workbench.
// Generating a replacement invalidates the old key immediately.
export function CaptureKeyPanel({ enabled, readOnly = false }: { enabled: boolean; readOnly?: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const run = async (action: () => Promise<{ notice?: string; error?: string; token?: string }>) => {
    if (pending || readOnly) return;
    setMessage(null);
    setPending(true);
    try {
      const result = await action();
      setMessage(result.notice ?? result.error ?? null);
      if (!result.error) setToken(result.token ?? "");
    } catch {
      setMessage("Could not update the capture key. Reload the page and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-lg">Browser extension</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The extension reads a profile only when you click it. Its key identifies this
          account independently of website sign-in. Copy a new key now; it cannot be displayed again.
        </p>
      </div>
      {readOnly ? <p className="text-sm text-ink-soft">Capture keys are private. They cannot be viewed or changed in read-only mode.</p> : <>
        {token && <div className="space-y-2">
          <span className="field-label">New capture key — shown once</span>
          <input aria-label="New capture key" className="field-input font-mono" value={token} readOnly autoComplete="off" />
          <CopyButton text={token} label="Copy key" className="btn-secondary" />
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(regenerateCaptureToken)}>
            {enabled ? "Generate a new key" : "Generate a capture key"}
          </button>
          {enabled && <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(clearCaptureToken)}>Switch capture off</button>}
          {!enabled && <span className="text-sm text-ink-soft">Capture is currently switched off.</span>}
        </div>
      </>}
      {message && <p role="status" data-form-message="notice" className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink">{message}</p>}
    </div>
  );
}
