/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#f3f5f7',
          card: '#ffffff',
          line: '#e2e6eb',
        },
        ink: {
          DEFAULT: '#1a2332',
          muted: '#5c6b7a',
          faint: '#8a97a5',
        },
        accent: {
          DEFAULT: '#0d7377',
          soft: '#e6f3f3',
          hover: '#0a5c5f',
        },
        dark: {
          900: '#0a0a0a',
          800: '#121212',
          700: '#1a1a1a',
        },
        primary: {
          500: '#0d7377',
          400: '#14919b',
          300: '#2aa6b0',
          100: '#d8f3f4',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
