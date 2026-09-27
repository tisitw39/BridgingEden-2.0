import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FCFAF3",
        forest: "#1C5F21",
        footer: "#1B5E20",
        sage: "#A5D6A7",
        sand: "#F3EFE5",
        mint: "#DFF0E1",
        pale: "#F1F8F1",
        line: "#C7E6C8",
        ink: "#1E2923",
        muted: "#577E49",
        accent: "#398E3D",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        header: "0 1px 2px rgba(28, 95, 33, 0.06)",
      },
      maxWidth: {
        page: "1280px",
      },
    },
  },
  plugins: [],
};

export default config;
