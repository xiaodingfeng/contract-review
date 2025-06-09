/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#3B82F6',   // Blue 500 - for buttons and links
        'primary-light': '#EFF6FF', // Blue 50 - for hover/active backgrounds
        'primary-dark': '#2563EB', // Blue 600
        'text-dark': '#111827', // Gray 900 - for headings
        'text-main': '#374151', // Gray 700
        'text-light': '#6B7280', // Gray 500 - for subtitles
        'bg-main': '#FFFFFF', // White
        'bg-subtle': '#F9FAFB', // Gray 50 - for a slightly off-white background
        'border-color': '#E5E7EB', // Gray 200
        'success': '#10B981',
        'danger': '#EF4444',
        'warning': '#F59E0B',
      },
    },
  },
  plugins: [],
} 