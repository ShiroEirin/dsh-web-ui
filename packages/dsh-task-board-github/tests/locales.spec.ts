/**
 * Copy of the GitHub provider extension: the zh dictionary is the key-set
 * source of truth and the English counterpart must mirror it.
 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('GitHub provider extension copy', () => {
  it('user switching the interface language sees every key translated', () => {
    // Given the zh dictionary every other language mirrors
    // When the English counterpart is compared with it
    // Then both sides carry exactly the same keys
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('user reading the card sees every line carrying text', () => {
    // Given the copy the card renders
    // When each value is inspected
    // Then no entry is blank on either side
    expect(Object.values(zh).filter(value => value.trim() === '')).toEqual([])
    expect(Object.values(en).filter(value => value.trim() === '')).toEqual([])
  })
})
