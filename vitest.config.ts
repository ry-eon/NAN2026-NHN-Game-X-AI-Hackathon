import { defineConfig } from 'vitest/config'

// vite.config.ts는 client 빌드용이라 root가 client로 잡혀 있다.
// 테스트는 리포 루트 기준으로 core(추후 bots/pipeline)를 대상으로 한다.
export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts', 'bots/test/**/*.test.ts', 'pipeline/test/**/*.test.ts'],
  },
})
