"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { clearCaptureToken, regenerateCaptureToken } from "@/app/actions/settings";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icon";

export function ExtensionMark() {
  return <span className="settings-app-icon"><Image src="/brand/retrivr-mark.png" alt="" width={265} height={215} unoptimized /></span>;
}

// The key is shown only when generated: the database stores its hash, and it
// belongs to this account rather than whichever website session is open.
// Share it only with the capture extension connected to this workbench.
// Generating a replacement invalidates the old key immediately, and switching
// off is asked twice for the same reason.
export function CaptureKeyPanel({ enabled, readOnly = false }: { enabled: boolean; readOnly?: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [confirmingOff, setConfirmingOff] = useState(false);

  const run = async (action: () => Promise<{ notice?: string; error?: string; token?: string }>) => {
    if (pending || readOnly) return;
    setMessage(null);
    setConfirmingOff(false);
    setPending(true);
    try {
      const result = await action();
      if (result.error) setMessage({ text: result.error, error: true });
      else {
        setToken(result.token ?? "");
        // A new key carries its own instructions beside it; only switching off
        // needs a line of its own.
        if (!result.token && result.notice) setMessage({ text: result.notice, error: false });
      }
    } catch {
      setMessage({ text: "Could not update the extension key. Reload the page and try again.", error: true });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="settings-integration" role="region" aria-label="Browser extension">
      <div className="settings-integration-head">
        <ExtensionMark />
        <div className="min-w-0 flex-1">
          <p className="settings-label">
            Browser extension
            {!readOnly && <span className={`settings-status${enabled ? " is-on" : ""}`}>{enabled ? "Key active" : "Off"}</span>}
          </p>
          <p className="settings-hint">Saves a LinkedIn profile to a role when you click it. Its key ties it to this account, separately from your sign-in.</p>
        </div>
      </div>
      {readOnly ? <p className="settings-hint">These keys are private. They cannot be viewed or changed in read-only mode.</p> : <>
        <ol className="settings-steps">
          <li>
            <p className="settings-step-title">Install it in Chrome</p>
            <div className="settings-actions">
              <a href="/api/extension/download" download className="btn-secondary">Download extension ZIP<Icon name="download" size={16} /></a>
              <Link href="/getting-started" className="settings-link">Installation steps</Link>
            </div>
          </li>
          <li>
            <p className="settings-step-title">Connect it with a key</p>
            {token ? (
              <div className="settings-key">
                <label htmlFor="new-extension-key" className="settings-label">New extension key</label>
                <div className="settings-key-row">
                  <input id="new-extension-key" className="field-input font-mono" value={token} readOnly autoComplete="off" aria-describedby="new-extension-key-hint" />
                  <CopyButton text={token} label="Copy key" className="btn-secondary" />
                </div>
                <p id="new-extension-key-hint" className="settings-hint is-strong">Shown once. Copy it now and paste it into the extension; any older key has stopped working.</p>
              </div>
            ) : (
              <p className="settings-hint">
                {enabled
                  ? "A key is active. A new one replaces it, and the old key stops working at once."
                  : "Generate a key and paste it into the extension. It is shown only once."}
              </p>
            )}
            <div className="settings-actions">
              <button type="button" className={enabled ? "btn-secondary" : "btn-primary"} disabled={pending} onClick={() => run(regenerateCaptureToken)}>
                {enabled ? "Generate a new key" : "Generate an extension key"}
              </button>
            </div>
          </li>
        </ol>
        {enabled && <div className="settings-integration-foot">
          {confirmingOff ? <>
            <p className="settings-hint">The extension stops saving until you generate a new key.</p>
            <div className="settings-actions">
              <button type="button" className="btn-destructive" disabled={pending} onClick={() => run(clearCaptureToken)}>Yes, switch it off</button>
              <button type="button" className="settings-link-button" disabled={pending} onClick={() => setConfirmingOff(false)}>Cancel</button>
            </div>
          </> : (
            <button type="button" className="settings-link-button is-danger" disabled={pending} onClick={() => setConfirmingOff(true)}>Switch off extension</button>
          )}
        </div>}
      </>}
      {message && (message.error
        ? <p role="alert" data-form-message="error" className="settings-hint is-error">{message.text}</p>
        : <p role="status" data-form-message="notice" className="settings-hint">{message.text}</p>)}
    </div>
  );
}
