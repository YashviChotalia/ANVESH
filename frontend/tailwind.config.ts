import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "'Inter Variable'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { DEFAULT: "#0A0F1C", 900: "#0A0F1C", 800: "#111827", 700: "#1C2436", 600: "#2A3448", 400: "#7A859B" },
        canvas: "#F4F5F8",
        line: "#E3E6EC",
        brand: { DEFAULT: "#F26B1D", 50: "#FEF3EC", 100: "#FDE3D2", 600: "#D9560B", 700: "#B4460A" },
        signal: {
          crit: "#D92D20", critbg: "#FEF3F2", high: "#DC6803", highbg: "#FFFAEB",
          ok: "#079455", okbg: "#ECFDF3", info: "#3E4BDB", infobg: "#EEF1FF",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        lift: "0 8px 24px -8px rgba(16,24,40,.18)",
      },
      keyframes: {
        pulsering: { "0%": { boxShadow: "0 0 0 0 rgba(217,45,32,.45)" }, "100%": { boxShadow: "0 0 0 10px rgba(217,45,32,0)" } },
        fadein: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { pulsering: "pulsering 1.6s ease-out infinite", fadein: "fadein .35s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
