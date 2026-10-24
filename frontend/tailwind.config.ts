import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: { xs2: ["11px", "16px"], sm2: ["13px", "20px"] },
      colors: {
        bg: "#F6F7F9",
        surface: "#FFFFFF",
        line: "#E4E7EC",
        line2: "#D0D5DD",
        fg: { DEFAULT: "#101828", 2: "#475467", 3: "#667085", 4: "#98A2B3" },
        accent: { DEFAULT: "#1849A9", soft: "#EFF4FF", line: "#B2CCFF" },
        crit: { DEFAULT: "#B42318", soft: "#FEF3F2", line: "#FECDCA" },
        warn: { DEFAULT: "#B54708", soft: "#FFFAEB", line: "#FEDF89" },
        ok: { DEFAULT: "#067647", soft: "#ECFDF3", line: "#ABEFC6" },
      },
      borderRadius: { DEFAULT: "6px", md: "8px" },
    },
  },
  plugins: [],
} satisfies Config;
