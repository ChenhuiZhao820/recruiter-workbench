"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { redeemPromoCode, type PromoState } from "@/app/actions/promo";

// "Have a promo code?" on the billing page: a quiet link that opens one field
// and a button. What the code does is decided on the server; this only shows
// a refusal, next to the field, keeping what was typed; success leaves the page.
// Rendered in two tabs at once (the hidden one stays in the page), hence `id`.
export function PromoCodeForm({ id, open: startOpen = false }: { id: string; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [state, action] = useFormState<PromoState, FormData>(redeemPromoCode, {});
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const field = `${id}-code`;
  const message = `${id}-message`;

  // Opened by the link in the banner, or refused: the field is where to look.
  useEffect(() => { if (startOpen) input.current?.focus(); }, [startOpen]);
  useEffect(() => { if (state.error) input.current?.focus(); }, [state]);

  if (!open) return <button type="button" className="promo-toggle" aria-expanded="false" onClick={() => { setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}>Have a promo code?</button>;

  return <form action={action} className="promo-form">
    <label htmlFor={field} className="field-label">Promo code</label>
    <div className="promo-row">
      <input
        ref={input} id={field} name="code" type="text" value={code} onChange={(event) => setCode(event.target.value)}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={100} className="field-input promo-input"
        aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? message : undefined}
      />
      <Redeem disabled={!code.trim()} />
    </div>
    <p id={message} role="status" className={state.error ? "promo-error" : "sr-only"}>{state.error ?? ""}</p>
  </form>;
}

function Redeem({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-primary" disabled={disabled || pending}>{pending ? "Redeeming…" : "Redeem"}</button>;
}
