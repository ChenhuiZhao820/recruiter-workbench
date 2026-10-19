"use client";

import { useEffect } from "react";

// Plays each feature figure once as it scrolls into view. Figures that
// arrive together play one after another in reading order; Replay plays a
// card's figure again. Before and after, every figure rests on its last
// frame, so nothing depends on this running.
export function LandingMotion() {
  useEffect(() => {
    const replays = Array.from(document.querySelectorAll<HTMLButtonElement>(".lp-card .lp-replay"));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      replays.forEach((button) => { button.hidden = true; });
      return;
    }
    const play = (element: Element) => {
      element.classList.remove("lp-play");
      void (element as HTMLElement).offsetWidth;
      element.classList.add("lp-play");
    };
    const timers = new Set<number>();
    const figures = Array.from(document.querySelectorAll(".lp-card .lp-fig"));
    let next = 0;
    const queue = (element: Element) => {
      const at = Math.max(next, performance.now());
      next = at + 1400;
      const timer = window.setTimeout(() => { timers.delete(timer); play(element); }, at - performance.now());
      timers.add(timer);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries.sort((a, b) => figures.indexOf(a.target) - figures.indexOf(b.target))) {
        if (!entry.isIntersecting) continue;
        queue(entry.target);
        observer.unobserve(entry.target);
      }
    }, { threshold: .6 });
    figures.forEach((figure) => observer.observe(figure));
    const listeners = replays.map((button) => {
      const replay = () => { const figure = button.closest(".lp-card")?.querySelector(".lp-fig"); if (figure) play(figure); };
      button.addEventListener("click", replay);
      return () => button.removeEventListener("click", replay);
    });
    return () => {
      observer.disconnect();
      timers.forEach((timer) => clearTimeout(timer));
      listeners.forEach((remove) => remove());
    };
  }, []);
  return null;
}
