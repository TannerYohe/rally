import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['src/**/*.test.ts'],
    // Gives tests that run real git commands room for slow process startup on Windows runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Serves stylesheet text to `?raw` imports, which Vitest otherwise stubs as empty strings.
    css: { include: [/\.css\?raw$/] },
  },
})
