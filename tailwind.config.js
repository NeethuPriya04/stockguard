/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkbg: "#0a0a0a",
        brandGreen: "#10b981",
        brandRed: "#ef4444",
      }
    },
  },
  plugins: [],
}
