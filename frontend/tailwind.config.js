/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        shroom: {
          bg: '#0b0f14',
          surface: '#111826',
          border: '#1f2a3a',
          accent: '#10b981',
          warn: '#f59e0b',
          alert: '#ef4444',
          light: '#facc15',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
