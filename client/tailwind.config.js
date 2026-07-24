/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        md3: {
          primary: '#1B6EF3',
          'on-primary': '#FFFFFF',
          'primary-container': '#D8E6FF',
          'on-primary-container': '#001946',
          secondary: '#F59E0B',
          'secondary-container': '#FFECC2',
          'on-secondary-container': '#241A00',
          tertiary: '#6B4EFF',
          'tertiary-container': '#E8DDFF',
          surface: '#F8F9FF',
          'surface-variant': '#E1E2EC',
          'on-surface': '#1A1B22',
          'on-surface-variant': '#44464F',
          error: '#BA1A1A',
          'error-container': '#FFDAD6',
          background: '#F8F9FF',
          outline: '#74767F',
          'outline-variant': '#C4C6D0',
          'scan-dark': '#1A1B22',
        },
      },
      fontFamily: {
        sans: ['Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['Roboto Mono', 'Roboto', 'monospace'],
      },
      borderRadius: {
        'md3-xs': '4px',
        'md3-sm': '8px',
        'md3-md': '12px',
        'md3-lg': '16px',
        'md3-xl': '28px',
        'md3-full': '9999px',
      },
    },
  },
  plugins: [],
};
