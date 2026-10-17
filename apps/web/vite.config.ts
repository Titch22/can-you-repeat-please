import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const server = 'http://localhost:3000';

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
      '/sounds': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
