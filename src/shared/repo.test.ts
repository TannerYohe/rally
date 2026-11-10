import { describe, expect, it } from 'vitest'
import { releasePageUrl } from './repo'

describe('releasePageUrl', () => {
  it('links to the release tagged with the version', () => {
    expect(releasePageUrl('1.9.1')).toBe('https://github.com/TannerYohe/rally/releases/tag/v1.9.1')
  })
})
