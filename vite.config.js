import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' keeps the app from breaking when hosted from a GitHub Pages repo path.
export default defineConfig({
  plugins: [react()],
  base: './'
});
