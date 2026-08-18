/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#008C88',
        'primary-light': '#EDF7F5',
        'primary-dark': '#006F6C',
        'text-dark': '#173533',
        'text-main': '#344B49',
        'text-light': '#6C7C7A',
        'bg-main': '#FFFFFF',
        'bg-subtle': '#F6F7F3',
        'border-color': '#DDE4DF',
        'success': '#10B981',
        'danger': '#EF4444',
        'warning': '#F59E0B',
      },
    },
  },
  plugins: [],
}
