import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vb: {
          pink: {
            50:  '#fff0f5',
            100: '#ffdde9',
            200: '#ffcde1',
            300: '#f9c5d1',
            400: '#f2a7c0',
            500: '#e88aa8',
            600: '#d4698a',
          },
          blue: {
            50:  '#e8f4ff',
            100: '#c2e9fb',
            200: '#a6d8ff',
            300: '#91cbe6',
            400: '#74bcd9',
            500: '#4dabf5',
            600: '#2196f3',
          },
          purple: {
            100: '#e6d4ff',
            400: '#d4b9ff',
            500: '#a484c4',
          },
        },
      },
      fontFamily: {
        inter:    ['var(--font-inter)', 'sans-serif'],
        'dm-sans': ['var(--font-dm-sans)', 'sans-serif'],
      },
      keyframes: {
        gradientFlow: {
          '0%':   { backgroundPosition: '0% 50%' },
          '50%':  { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'gradient-flow': 'gradientFlow 10s ease infinite',
        'fade-in-up':    'fadeInUp 0.35s ease-out forwards',
      },
      transitionDuration: {
        '400': '400ms',
      },
      backdropBlur: {
        glass: '15px',
        'glass-strong': '20px',
      },
    },
  },
  plugins: [],
};

export default config;
