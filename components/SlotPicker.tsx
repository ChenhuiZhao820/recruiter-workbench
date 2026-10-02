"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { bookSlot } from "@/app/actions/booking";
import { EMPTY_FORM_STATE } from "@/lib/formState";
import { SubmitButton } from "@/components/SubmitButton";

const VISIBLE_DAYS = 5;

// The candidate's side of the booking page. Times arrive as instants and are
// shown in the candidate's own time zone, read from their browser and
// changeable, because a recruiter in London and a candidate in Lisbon should
// both see the right hour.
export function SlotPicker({
  token,
  slots,
  durationMins,
  offerVideo,
  offerPhone,
  recruiterZone,
  notice,
}: {
  token: string;
  slots: number[];
  durationMins: number;
  offerVideo: boolean;
  offerPhone: boolean;
  recruiterZone: string;
  notice: string;
}) {
  const [state, action] = useFormState(bookSlot, EMPTY_FORM_STATE);
  const [zone, setZone] = useState(recruiterZone);
  const [mode, setMode] = useState(offerVideo ? "video" : "phone");
  const [chosen, setChosen] = useState<number | null>(null);
  // The first few days are enough for most people; the rest wait behind a
  // button so the details form is not a long scroll away on a phone.
  const [allDays, setAllDays] = useState(false);

  useEffect(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local) setZone(local);
    } catch {
      // Keep the recruiter's zone.
    }
  }, []);

  const days = useMemo(() => {
    const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" });
    const groups = new Map<string, number[]>();
    for (const slot of slots) {
      const label = dayLabel.format(new Date(slot));
      groups.set(label, [...(groups.get(label) ?? []), slot]);
    }
    return Array.from(groups.entries());
  }, [slots, zone]);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const zones = useMemo(() => Array.from(new Set([zone, recruiterZone, "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "America/New_York", "Asia/Dubai"])), [zone, recruiterZone]);

  if (slots.length === 0) {
    return (
      <div className="booking-empty">
        <h2 className="section-heading">No free times right now</h2>
        <p className="section-caption">Every time in the next few days is taken. Reply to the message that sent you this link and a time will be found.</p>
      </div>
    );
  }

  return (
    <form action={action} className="booking-form">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>
      )}

      <fieldset className="space-y-4">
        <legend className="section-heading">Choose a time</legend>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span>{durationMins} minutes. Times shown in</span>
          <label htmlFor="booking-zone" className="sr-only">Time zone</label>
          <select id="booking-zone" value={zone} onChange={(event) => setZone(event.target.value)} className="booking-zone">
            {zones.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="booking-days">
          {(allDays ? days : days.slice(0, VISIBLE_DAYS)).map(([label, daySlots]) => (
            <div key={label} role="group" aria-label={label} className="booking-slot-day">
              <p className="booking-slot-day-name">{label}</p>
              <div className="booking-slots">
                {daySlots.map((slot) => (
                  <label key={slot} className="booking-slot" data-chosen={chosen === slot}>
                    <input type="radio" name="slot" value={slot} required onChange={() => setChosen(slot)} className="sr-only" />
                    <span className="tabular">{time.format(new Date(slot))}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!allDays && days.length > VISIBLE_DAYS && (
          <button type="button" className="btn-secondary" onClick={() => setAllDays(true)}>
            Show {days.length - VISIBLE_DAYS} more {days.length - VISIBLE_DAYS === 1 ? "day" : "days"}
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="section-heading">Your details</legend>
        <div>
          <label htmlFor="booking-email" className="field-label">Email address</label>
          <input id="booking-email" name="email" type="email" required autoComplete="email" className="field-input" />
        </div>
        {offerVideo && offerPhone && (
          <div role="radiogroup" aria-label="How would you like to talk?" className="booking-modes">
            <label className="booking-mode" data-chosen={mode === "video"}>
              <input type="radio" name="mode" value="video" checked={mode === "video"} onChange={() => setMode("video")} className="screening-check" />
              Video call
            </label>
            <label className="booking-mode" data-chosen={mode === "phone"}>
              <input type="radio" name="mode" value="phone" checked={mode === "phone"} onChange={() => setMode("phone")} className="screening-check" />
              Phone call
            </label>
          </div>
        )}
        {!(offerVideo && offerPhone) && <input type="hidden" name="mode" value={mode} />}
        {mode === "phone" && (
          <div>
            <label htmlFor="booking-phone" className="field-label">Phone number to call you on</label>
            <input id="booking-phone" name="phone" type="tel" required autoComplete="tel" className="field-input" placeholder="+44 7700 900123" />
          </div>
        )}
        <label className="screening-consent">
          <input type="checkbox" name="consent" required className="screening-check" />
          <span>I have read how my details are used, below, and agree that notes or a transcript of the call may be kept.</span>
        </label>
        <label className="screening-consent">
          <input type="checkbox" name="keep" className="screening-check" />
          <span>
            Keep my details for future roles
            <span className="block text-xs text-ink-soft">Optional. Without it, your details are kept only for this role.</span>
          </span>
        </label>
        <details className="booking-notice">
          <summary>How your details are used</summary>
          <p>{notice}</p>
        </details>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Booking...">Book this call</SubmitButton>
        <p className="text-xs text-ink-soft" role="status">{chosen ? `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(chosen))}` : "Choose a time above."}</p>
      </div>
    </form>
  );
}

// The confirmed time, in the candidate's own zone.
export function LocalTime({ at, recruiterZone }: { at: number; recruiterZone: string }) {
  const [zone, setZone] = useState(recruiterZone);
  useEffect(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local) setZone(local);
    } catch {
      // Keep the recruiter's zone.
    }
  }, []);
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
  return <>{text} <span className="text-ink-soft">({zone.replace(/_/g, " ")})</span></>;
}
