/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./app.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#07111A', // deep royal blue-black
          card: 'rgba(15, 23, 42, 0.7)',
          secondary: '#0E1A24',
        },
        accent: {
          teal: '#14B8A6',
          gold: '#D4AF37',
          cyan: '#67E8F9',
        },
        text: {
          primary: '#F8FAFC',
          secondary: '#94A3B8',
        },
        border: 'rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      backgroundImage: {
        'radial-glow': 'radial-gradient(circle at center, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}
