/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#1a1b2e",
          light: "#252636",
          card: "#2a2b3d",
          hover: "#2f3050",
          border: "#363752",
        },
        accent: {
          blue: "#6c8ebf",
          purple: "#8b6cbf",
          glow: "#4a6fa5",
          teal: "#4ea5a0",
          green: "#4caf7d",
          red: "#e05555",
          orange: "#e09050",
        },
        text: {
          primary: "#e8eaf0",
          secondary: "#9ca3b0",
          muted: "#6b7280",
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        tick: "tick 1s steps(1) infinite",
        "fade-in": "fadeIn 0.2s ease-out",
      },
      keyframes: {
        tick: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "24px",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.37)",
        glow: "0 0 20px rgba(108, 142, 191, 0.2)",
      },
    },
  },
  plugins: [],
};
