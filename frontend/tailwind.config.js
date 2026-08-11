/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#f2f4f3',
          card: '#ffffff',
          line: '#e2ebe7',
          elevated: 'rgba(255,255,255,0.62)',
        },
        mist: '#e8f0ec',
        ink: {
          DEFAULT: '#0f1a16',
          muted: '#5b6b64',
          faint: '#8a9a92',
        },
        cedar: {
          DEFAULT: '#1a7a62',
          soft: '#e8f5f0',
          ink: '#0f3d32',
          hover: '#146853',
        },
        accent: {
          DEFAULT: '#1a7a62',
          soft: '#e8f5f0',
          hover: '#146853',
        },
        primary: {
          500: '#1a7a62',
          400: '#24967a',
          300: '#3fb896',
          100: '#d8f0e8',
          50: '#eef8f4',
        },
        dark: {
          900: '#0a0a0a',
          800: '#121212',
          700: '#1a1a1a',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 0 rgba(255,255,255,0.55) inset, 0 6px 20px rgba(15, 26, 22, 0.05)',
        lift: '0 1px 0 rgba(255,255,255,0.65) inset, 0 14px 36px rgba(26, 122, 98, 0.12)',
        float: '0 1px 0 rgba(255,255,255,0.7) inset, 0 24px 64px rgba(15, 26, 22, 0.16)',
        ring: '0 0 0 4px rgba(26, 122, 98, 0.14)',
      },
      transitionTimingFunction: {
        /* critically damped settle */
        apple: 'cubic-bezier(0.22, 1, 0.36, 1)',
        /* only for momentum gestures — slight overshoot */
        spring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
      },
      transitionDuration: {
        press: '100ms',
        settle: '380ms',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.78' },
        },
        materialize: {
          from: { opacity: '0', transform: 'scale(0.97) translateY(8px)', filter: 'blur(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)', filter: 'blur(0)' },
        },
        'fade-cross': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2.8s ease-in-out infinite',
        'fade-up': 'materialize 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-cross 0.28s ease-out both',
        'scale-in': 'materialize 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'fade-cross 0.28s ease-out both',
      },
    },
  },
  plugins: [],
};
