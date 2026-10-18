import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Game server to proxy to (override to run a second stack side by side).
const server = process.env.API_TARGET ?? 'http://localhost:3000';
// Sound library service (apps/sounds), reached as /sounds-api like in the dev SOUNDS_PUBLIC_URL.
const sounds = process.env.SOUNDS_TARGET ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // IPv4 on purpose: by default Vite listens on [::1], and Firefox refuses to gather WebRTC
    // ICE candidates on pages loaded over IPv6 loopback, so voice never connects.
    // 0.0.0.0 also lets other devices on the LAN open the dev build.
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': server,
      '/sounds-api': { target: sounds, rewrite: (path) => path.replace(/^\/sounds-api/, '') },
      '/socket.io': { target: server, ws: true },
    },
  },
});
