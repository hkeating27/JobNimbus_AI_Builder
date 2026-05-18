import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // JobNimbus brand palette (sampled from their site CSS).
        // Primary #3968C6, deep navy #152952, signature lime #bdfd2e.
        brand: {
          50:  "#ebf0fa",  // light page-bg tint (from their site)
          100: "#dde7f5",
          200: "#b9ccea",
          300: "#85a6d8",
          400: "#5b86cf",
          500: "#3968C6",  // PRIMARY — JobNimbus blue
          600: "#2d52a0",  // hover
          700: "#234080",
          800: "#1c3260",
          900: "#152952",  // deep navy — headers / typography
        },
        // Their signature lime — striking, used sparingly for highlights.
        accent: {
          400: "#d6ff5e",
          500: "#bdfd2e",
          600: "#9fdc1c",
        },
        ink: {
          900: "#0b1220",
          700: "#283041",
          500: "#5a667c",
          300: "#aab2c0",
          100: "#e6e9ef",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Helvetica", "Arial", "sans-serif"],
        display: ["ui-sans-serif", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.06)",
        ring: "0 0 0 1px rgba(11,18,32,0.06), 0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
