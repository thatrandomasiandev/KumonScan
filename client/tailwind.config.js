/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        kumon: {
          blue: '#003087',
          'blue-dark': '#002060',
          'blue-light': '#E8EEF7',
          red: '#E31837',
          'red-light': '#FDF0F2',
          light: '#F4F6F9',
          surface: '#FAFBFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0, 48, 135, 0.06), 0 8px 24px rgba(0, 48, 135, 0.04)',
        'card-hover': '0 4px 12px rgba(0, 48, 135, 0.1), 0 16px 32px rgba(0, 48, 135, 0.06)',
        nav: '0 -1px 0 rgba(0, 48, 135, 0.08)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
