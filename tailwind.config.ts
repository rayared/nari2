import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0b0c0f",
        surface: "#15171c",
        surface2: "#1e2129",
        accent: "#ff5a3c", // soti button color
        accent2: "#3ba3ff",
        ok: "#3ecf8e",
        warn: "#ffb020",
        danger: "#ff4d4f",
      },
      fontFamily: {
        vazir: ["Vazirmatn", "sans-serif"],
      },
      spacing: {
        touch: "48px",
        soti: "72px",
      },
    },
  },
  plugins: [],
};

export default config;
