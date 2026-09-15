import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1c2a24",
        paper: "#faf8f3",
        surface: "#fffefb",
        line: "#e4ddd0",
        accent: "#2f6f4f",
        amber: "#b7791f",
        rust: "#a13d2f",
        muted: "#8a8578",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,42,24,0.04), 0 10px 24px -14px rgba(28,42,24,0.18)",
        "card-hover": "0 1px 2px rgba(28,42,24,0.05), 0 16px 32px -14px rgba(28,42,24,0.24)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};
export default config;
