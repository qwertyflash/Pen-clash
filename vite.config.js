import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2020', sourcemap: true },
  server: {
    host: true, // reachable from other devices on your Wi-Fi during development
    // `npm run dev` + `npm start` in another terminal: online play uses the local relay.
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true }, '/api': 'http://localhost:3000' },
  },
});
