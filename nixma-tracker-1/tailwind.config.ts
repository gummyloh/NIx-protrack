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
        paper: "#f5f6fa",
        surface: "#ffffff",
        line: "#e6e8f0",
        accent: "#00c875",
        amber: "#fdab3d",
        rust: "#e2445c",
        muted: "#c4c4c4",
        completed: "#323338",
      },
      fontFamily: {
        sans: ["'Poppins'", "system-ui", "sans-serif"],
        mono: ["'Poppins'", "system-ui", "sans-serif"],
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
