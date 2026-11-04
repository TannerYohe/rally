import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['src/**/*.test.ts'],
    // Serves stylesheet text to `?raw` imports, which Vitest otherwise stubs as empty strings.
    css: { include: [/\.css\?raw$/] },
  },
})
