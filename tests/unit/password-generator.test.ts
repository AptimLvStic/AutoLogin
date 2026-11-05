import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  PASSWORD_GENERATOR_MAX_LENGTH,
  PASSWORD_GENERATOR_MIN_LENGTH,
  generatePassword,
  passwordGeneratorEntropy,
  passwordGeneratorStrength,
  type PasswordGeneratorOptions
} from '../../src/shared/password-generator'

const ALL_TYPES: PasswordGeneratorOptions = {
  ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  length: 32
}

describe('password generator', () => {
  it('generates the requested length and includes every enabled character type', () => {
    for (let index = 0; index < 12; index += 1) {
      const password = generatePassword(ALL_TYPES)
      expect(password).toHaveLength(32)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[!@#$%^&*()\-_=+\[\]{};:,.?/]/)
    }
  })

  it('excludes look-alike characters when requested', () => {
    const password = generatePassword({
      ...ALL_TYPES,
      excludeSimilar: true,
      length: 128
    })
    expect(password).not.toMatch(/[Il1O0o]/)
  })

  it('clamps lengths to the supported UI range', () => {
    expect(
      generatePassword({ ...ALL_TYPES, length: PASSWORD_GENERATOR_MIN_LENGTH - 50 })
    ).toHaveLength(PASSWORD_GENERATOR_MIN_LENGTH)
    expect(
      generatePassword({ ...ALL_TYPES, length: PASSWORD_GENERATOR_MAX_LENGTH + 50 })
    ).toHaveLength(PASSWORD_GENERATOR_MAX_LENGTH)
  })

  it('rejects an empty character selection', () => {
    expect(() =>
      generatePassword({
        ...ALL_TYPES,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false
      })
    ).toThrow('Select at least one character type')
  })

  it('reports higher entropy and strength for longer mixed passwords', () => {
    expect(passwordGeneratorEntropy(ALL_TYPES)).toBeGreaterThan(
      passwordGeneratorEntropy({ ...ALL_TYPES, length: 10 })
    )
    expect(passwordGeneratorStrength(ALL_TYPES)).toBe('strong')
    expect(
      passwordGeneratorStrength({
        ...ALL_TYPES,
        length: 8,
        uppercase: false,
        symbols: false
      })
    ).toBe('weak')
  })
})
