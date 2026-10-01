import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        texter: {
          bg: "#07090E",
          surface: {
            DEFAULT: "#0E121B",
            card: "#0E121B",
            hover: "#141A26",
            subtle: "#0A0D15",
            elevated: "#121824",
          },
          border: {
            DEFAULT: "#1E2536",
            subtle: "#161B29",
            hover: "#2A344D",
            focus: "#6366F1",
          },
          hover: "#2A344D",
          indigo: {
            DEFAULT: "#6366F1",
            glow: "rgba(99, 102, 241, 0.15)",
            hover: "#4F46E5",
          },
          cyan: {
            DEFAULT: "#06B6D4",
            glow: "rgba(6, 182, 212, 0.15)",
            hover: "#0891B2",
          },
          emerald: "#10B981",
          amber: "#F59E0B",
          rose: "#EF4444",
          text: {
            primary: "#F8FAFC",
            secondary: "#94A3B8",
            muted: "#64748B",
            dim: "#475569",
          }
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "Geist", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "texter-card": "0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px #1E2536",
        "texter-glow-indigo": "0 0 25px -5px rgba(99, 102, 241, 0.25)",
        "texter-glow-cyan": "0 0 25px -5px rgba(6, 182, 212, 0.25)",
      },
      animation: {
        "pulse-subtle": "pulseSubtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "shimmer": "shimmer 2s linear infinite",
      },
      keyframes: {
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
