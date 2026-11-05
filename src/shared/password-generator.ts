export const PASSWORD_GENERATOR_MIN_LENGTH = 8
export const PASSWORD_GENERATOR_MAX_LENGTH = 128
export const PASSWORD_GENERATOR_DEFAULT_LENGTH = 20

export interface PasswordGeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  excludeSimilar: boolean
}

export const DEFAULT_PASSWORD_GENERATOR_OPTIONS: PasswordGeneratorOptions = {
  length: PASSWORD_GENERATOR_DEFAULT_LENGTH,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeSimilar: false
}

const CHARACTER_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/'
} as const

const SIMILAR_CHARACTERS = new Set(['I', 'l', '1', 'O', '0', 'o'])

function secureRandomIndex(max: number): number {
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new Error('Invalid random range')
  }
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random source is unavailable')
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const values = new Uint32Array(1)
  let value = 0
  do {
    cryptoApi.getRandomValues(values)
    value = values[0] ?? 0
  } while (value >= limit)
  return value % max
}

export function passwordGeneratorPools(
  options: PasswordGeneratorOptions
): string[] {
  const enabled = [
    options.uppercase ? CHARACTER_SETS.uppercase : '',
    options.lowercase ? CHARACTER_SETS.lowercase : '',
    options.numbers ? CHARACTER_SETS.numbers : '',
    options.symbols ? CHARACTER_SETS.symbols : ''
  ].filter(Boolean)
  if (enabled.length === 0) {
    throw new Error('Select at least one character type')
  }
  return enabled.map((characters) =>
    options.excludeSimilar
      ? [...characters].filter((character) => !SIMILAR_CHARACTERS.has(character)).join('')
      : characters
  )
}

export function generatePassword(options: PasswordGeneratorOptions): string {
  const length = Math.max(
    PASSWORD_GENERATOR_MIN_LENGTH,
    Math.min(PASSWORD_GENERATOR_MAX_LENGTH, Math.round(options.length))
  )
  const pools = passwordGeneratorPools(options)
  const combined = pools.join('')
  if (!combined) throw new Error('Selected character pools are empty')

  const generated = pools.map((pool) => pool[secureRandomIndex(pool.length)])
  while (generated.length < length) {
    generated.push(combined[secureRandomIndex(combined.length)])
  }
  for (let index = generated.length - 1; index > 0; index -= 1) {
    const target = secureRandomIndex(index + 1)
    ;[generated[index], generated[target]] = [generated[target], generated[index]]
  }
  return generated.join('')
}

export function passwordGeneratorEntropy(options: PasswordGeneratorOptions): number {
  const poolSize = passwordGeneratorPools(options).join('').length
  return Math.round(options.length * Math.log2(poolSize) * 10) / 10
}

export type PasswordStrength = 'weak' | 'good' | 'strong'

export function passwordGeneratorStrength(
  options: PasswordGeneratorOptions
): PasswordStrength {
  const entropy = passwordGeneratorEntropy(options)
  if (entropy < 60) return 'weak'
  if (entropy < 90) return 'good'
  return 'strong'
}
