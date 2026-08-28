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
        cream: "rgb(var(--rgb-cream) / <alpha-value>)",
        brass: "rgb(var(--rgb-brass) / <alpha-value>)",
        "brass-lite": "rgb(var(--rgb-brass-lite) / <alpha-value>)",
        line: "rgb(var(--rgb-line) / <alpha-value>)",
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
