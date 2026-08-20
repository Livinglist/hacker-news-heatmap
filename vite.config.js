import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Served from the domain root on Cloudflare (and with a custom domain).
  base: '/',
  plugins: [react()],
})
