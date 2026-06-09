import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ntopngTarget    = env.VITE_NTOPNG_BASE_URL  || 'https://flow-ntop.aquitelecom.com'
  const cfAuthorization = env.CF_AUTHORIZATION       || ''
  const ntopngToken     = env.VITE_NTOPNG_TOKEN      || ''
  const ntopngSession   = env.NTOPNG_SESSION         || ''

  // ── Headers injected into every upstream request ──────────────────────────
  const proxyHeaders: Record<string, string> = {}

  // 1. Cloudflare Access — bypass CF Zero Trust with JWT
  if (cfAuthorization) {
    proxyHeaders['Cookie']                  = `CF_Authorization=${cfAuthorization}`
    proxyHeaders['CF-Access-Jwt-Assertion'] = cfAuthorization
  }

  // 2. ntopng token — try both Authorization header styles that ntopng v6 accepts
  if (ntopngToken) {
    proxyHeaders['Authorization'] = `Token ${ntopngToken}`
    proxyHeaders['X-Auth-Token']  = ntopngToken
  }

  // 3. ntopng session cookie (fallback / override)
  //    ntopng stores sessions as "user=<username>:<md5_password>" cookie.
  //    Only inject when the value contains ":" — otherwise it's the API token
  //    (which belongs ONLY in the Authorization header, not in a cookie).
  if (ntopngSession && ntopngSession.includes(':')) {
    const existing = proxyHeaders['Cookie'] ?? ''
    proxyHeaders['Cookie'] = existing
      ? `${existing}; user=${ntopngSession}`
      : `user=${ntopngSession}`
  }
  // ──────────────────────────────────────────────────────────────────────────

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    server: {
      proxy: {
        '/api': {
          target:       env.VITE_API_URL || 'http://localhost:8000',
          changeOrigin: true,
        },
        '/ntopng-api': {
          target:       ntopngTarget,
          changeOrigin: true,
          secure:       false,
          // Don't let redirects to /lua/login.lua bleed back to localhost;
          // the API client will see a non-JSON 302/200 and report an auth error.
          followRedirects: false,
          rewrite: (path) => path.replace(/^\/ntopng-api/, ''),
          headers: proxyHeaders,
        },
      },
    },
  }
})
