import type { CSSProperties } from "react";

const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  external: "M7 17 17 7M7 7h10v10",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  roles: "M8 7V5h8v2M4 8h16v12H4zM4 12c5 3 11 3 16 0M10 13h4",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  search: "m20 20-4-4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  message: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  logout: "M9 4H4v16h5M9 12h12m-4-4 4 4-4 4",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  file: "M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
} as const;

export function Icon({ name, size = 20, className, style }: { name: keyof typeof paths; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name]} /></svg>;
}

export function CaptureMark({ className }: { className?: string }) {
  return <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
    <path d="M12 4H4v8M20 4h8v8M28 20v8h-8M12 28H4v-8" stroke="currentColor" strokeWidth="3" />
    <path d="M12 12h8v8h-8z" fill="currentColor" />
  </svg>;
}
