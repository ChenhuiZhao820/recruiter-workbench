"use client";

import { useEffect, useRef, useState } from "react";
import { PLAN_EVENT } from "@/components/landing/Pricing";

const ADDRESS = "aditya.shah@basanite.co.uk";

// The address is shown as text, because a mailto: link does nothing for
// anyone without a mail app; Copy is the other way to take it.
export function ContactBox() {
  const [plan, setPlan] = useState<string | null>(null);
  const [copy, setCopy] = useState("Copy");
  const address = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const choose = (event: Event) => setPlan((event as CustomEvent<string>).detail);
    window.addEventListener(PLAN_EVENT, choose);
    return () => window.removeEventListener(PLAN_EVENT, choose);
  }, []);
  useEffect(() => {
    if (copy === "Copy") return;
    const timer = window.setTimeout(() => setCopy("Copy"), 1800);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(ADDRESS);
      setCopy("Copied");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(address.current!);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      setCopy("Selected");
    }
  }

  return <>
    <div className="lp-email-box">
      <span className="lp-addr" ref={address}>{ADDRESS}</span>
      <button type="button" className="lp-btn" onClick={copyAddress}><svg><use href="#lp-i-copy" /></svg><span>{copy}</span></button>
      <a className="lp-btn lp-btn-primary" href={`mailto:${ADDRESS}?subject=${encodeURIComponent(plan ? `Retrivr ${plan}` : "Retrivr")}`}><svg><use href="#lp-i-mail" /></svg>Email us</a>
    </div>
    <p className="lp-contact-about" aria-live="polite">{plan && `About: ${plan}`}</p>
  </>;
}
