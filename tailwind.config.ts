import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--rgb-ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--rgb-ink-soft) / <alpha-value>)",
        paper: "rgb(var(--rgb-paper) / <alpha-value>)",
        surface: "rgb(var(--rgb-surface) / <alpha-value>)",
        sunken: "rgb(var(--rgb-sunken) / <alpha-value>)",
        line: "rgb(var(--rgb-line) / <alpha-value>)",
        accent: "rgb(var(--rgb-accent) / <alpha-value>)",
        "accent-hard": "rgb(var(--rgb-accent-hard) / <alpha-value>)",
        "accent-soft": "rgb(var(--rgb-accent-soft) / <alpha-value>)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
      spacing: {
        gap: "var(--gap)",
      },
    },
  },
  plugins: [],
};
export default config;
