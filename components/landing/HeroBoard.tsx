"use client";

import { useEffect, useRef, useState } from "react";

// Illustrative people only: the public page never shows workspace data.
const people = [
  ["mc", "MC", "Mei Chen"], ["to", "TO", "Tom Okafor"], ["sp", "SP", "Sam Patel"], ["ar", "AR", "Ana Ruiz"],
  ["jm", "JM", "Jamie Morgan"], ["pn", "PN", "Priya Nair"], ["lb", "LB", "Leo Brandt"],
] as const;
const lanes = ["Sourced", "Contacted", "Screened", "With client", "Interview"];
const start: Record<string, number> = { mc: 3, to: 2, sp: 1, ar: 1, jm: 0, pn: 0, lb: 0 };
const moves: [string, number][] = [["mc", 4], ["to", 3], ["sp", 2], ["jm", 1], ["ar", 2], ["pn", 1]];
const startCounts = lanes.map((_, lane) => Object.values(start).filter((value) => value === lane).length);

// Cards move lane to lane; a client's answer rings the bell. The loop runs
// only while the board is on screen, can be paused, and with reduced motion
// shows one still frame in which the client has already answered.
export function HeroBoard() {
  const boardRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const toggle = useRef<() => boolean>(() => false);
  const [paused, setPaused] = useState(false);
  // With reduced motion the board is one still frame, so there is nothing to pause.
  const [still, setStill] = useState(false);

  useEffect(() => {
    const board = boardRef.current!, badge = badgeRef.current!, toast = toastRef.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cards = Object.fromEntries<HTMLElement>(Array.from(board.querySelectorAll<HTMLElement>(".lp-pcard")).map((element) => [element.dataset.id!, element]));
    const order: string[] = people.map(([id]) => id);
    const timers = new Set<number>();
    const after = (callback: () => void, ms: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); callback(); }, ms);
      timers.add(timer);
    };
    const stop = () => { timers.forEach((timer) => clearTimeout(timer)); timers.clear(); };
    let col = { ...start }, step = 0, stopped = reduce, visible = true;

    function layout() {
      const laneElements = board.querySelectorAll<HTMLElement>(".lp-lane");
      const top = laneElements[0].querySelector<HTMLElement>(".lp-lane-body")!.offsetTop;
      const inset = innerWidth <= 640 ? 3 : 6;
      const stacks = [0, 0, 0, 0, 0];
      for (const id of order) {
        const lane = laneElements[col[id]], card = cards[id];
        card.style.left = `${lane.offsetLeft + inset}px`;
        card.style.width = `${lane.offsetWidth - inset * 2}px`;
        card.style.top = `${top + stacks[col[id]] * 52}px`;
        card.classList.toggle("lp-is-goal", col[id] === 4);
        stacks[col[id]]++;
      }
      board.querySelectorAll<HTMLElement>("[data-count]").forEach((count) => { count.textContent = String(stacks[Number(count.dataset.count)]); });
    }
    function tick() {
      if (step < moves.length) {
        const [id, to] = moves[step++];
        order.splice(order.indexOf(id), 1);
        order.push(id);
        col[id] = to;
        Object.values(cards).forEach((card: HTMLElement) => card.classList.remove("lp-just-moved"));
        cards[id].classList.add("lp-just-moved");
        layout();
        if (to === 4) after(() => { badge.classList.add("lp-on"); toast.classList.add("lp-on"); }, 650);
        if (step === 2) toast.classList.remove("lp-on");
        after(tick, 1700);
      } else {
        after(() => {
          board.classList.add("lp-fading");
          after(() => {
            col = { ...start };
            step = 0;
            order.splice(0, order.length, ...people.map(([id]) => id));
            Object.values(cards).forEach((card: HTMLElement) => card.classList.remove("lp-just-moved"));
            badge.classList.remove("lp-on");
            toast.classList.remove("lp-on");
            layout();
            board.classList.remove("lp-fading");
            after(tick, 1200);
          }, 450);
        }, 2600);
      }
    }
    function run() {
      stop();
      if (!stopped && visible) after(tick, 900);
    }

    layout();
    addEventListener("resize", layout);
    if (reduce) {
      for (const [id, to] of moves) col[id] = to;
      layout();
      badge.classList.add("lp-on");
      setStill(true);
    }
    toggle.current = () => {
      stopped = !stopped;
      if (stopped) stop(); else run();
      return stopped;
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) run(); else stop();
    }, { threshold: .25 });
    observer.observe(board);
    return () => { stop(); removeEventListener("resize", layout); observer.disconnect(); };
  }, []);

  return <div className="lp-window" role="img" aria-label="Illustration: candidates move across a role's pipeline from Sourced to Interview, and a client's interview request arrives as a notification.">
    <div className="lp-window-bar">
      <span className="lp-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span className="lp-grow">retrivr / roles / senior-data-engineer</span>
      <span className="lp-bell" aria-hidden="true"><svg><use href="#lp-i-bell" /></svg><span className="lp-badge" ref={badgeRef}>1</span></span>
      {!still && <button className="lp-icon-btn" type="button" aria-label={paused ? "Play animation" : "Pause animation"} onClick={() => setPaused(toggle.current())}><svg><use href={paused ? "#lp-i-play" : "#lp-i-pause"} /></svg></button>}
    </div>
    <div className="lp-board-head"><h3>Senior Data Engineer</h3><span className="lp-eyebrow">Northwind Analytics · illustrative</span></div>
    <div className="lp-board" ref={boardRef}>
      <div className="lp-lanes">
        {lanes.map((name, lane) => <div key={name} className={lane === 4 ? "lp-lane lp-is-goal" : "lp-lane"}><div className="lp-lane-title">{name} <b data-count={lane}>{startCounts[lane]}</b></div><div className="lp-lane-body"></div></div>)}
      </div>
      {people.map(([id, initials, name]) => <div key={id} className="lp-pcard" data-id={id}><span className="lp-av">{initials}</span><span>{name}</span></div>)}
      <div className="lp-toast" ref={toastRef}><span className="lp-dot"></span>Client wants to interview Mei Chen</div>
    </div>
    <div className="lp-caption"><span className="lp-dot" style={{ width: "4px", height: "4px" }}></span>Illustrative data · not a real workspace</div>
  </div>;
}
