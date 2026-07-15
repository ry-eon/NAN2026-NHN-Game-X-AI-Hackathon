import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// GitHub Pages는 https://<user>.github.io/<repo>/ 하위 경로에서 서빙되므로
// CI에서 GHPAGES_BASE=/<repo>/ 를 주입한다 (.github/workflows/deploy.yml).
// 로컬 dev/preview는 '/' 그대로.
export default defineConfig({
  root: 'client',
  base: process.env.GHPAGES_BASE ?? '/',
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
