/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/views/**/*.njk',
    './public/js/**/*.js',
    './src/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#13151a',
        paper: '#f8f4ec',
        accent: '#c35f3c',
        mist: '#dbe7f0',
        moss: '#637a5b'
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        body: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      },
      boxShadow: {
        panel: '0 16px 40px rgba(19, 21, 26, 0.08)'
      }
    }
  },
  plugins: []
};

