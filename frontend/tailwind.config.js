/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          900: "var(--navy-900)",
          800: "var(--navy-800)",
          700: "var(--navy-700)",
          600: "var(--navy-600)",
        },
        green: {
          DEFAULT: "var(--green)",
          bright: "var(--green-bright)",
        },
        gold: {
          DEFAULT: "var(--gold)",
          bright: "var(--gold-bright)",
          soft: "var(--gold-soft)",
        },
        infoblue: "var(--blue-light)",
        amber: { DEFAULT: "var(--amber)" },
        red: { DEFAULT: "var(--red)" },
        parchment: "var(--parchment)",
        ink: "var(--ink)",
      },
      fontFamily: {
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        sans: ['"Hanken Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        seal: "0 10px 40px -8px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,169,81,0.4)",
      },
    },
  },
  plugins: [],
}
