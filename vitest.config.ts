import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// vite.config.ts는 client 빌드용이라 root가 client로 잡혀 있다.
// 테스트는 리포 루트 기준으로 core/bots(추후 pipeline)를 대상으로 한다.
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core/src', import.meta.url)),
    },
  },
  test: {
    include: ['core/test/**/*.test.ts', 'bots/test/**/*.test.ts', 'pipeline/test/**/*.test.ts'],
  },
})
