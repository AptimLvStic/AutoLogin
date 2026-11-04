import type {
  AppSettings,
  ColorMode,
  ProxySettings,
  ThemeColors,
  ThemePreset
} from './types'
import { DEFAULT_TRASH_RETENTION_DAYS } from './types'

export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1F2328',
  accent: '#5C6BFF'
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  mode: 'custom',
  enabled: false,
  protocol: 'http',
  host: '',
  port: 8080,
  bypassList: 'localhost, 127.0.0.1, ::1',
  testUrl: 'https://www.google.com/'
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoLockMinutes: 10,
  trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
  colorMode: 'light',
  language: 'zh-CN',
  themePreset: 'magpie',
  customTheme: DEFAULT_THEME_COLORS,
  interfaceScale: 100,
  fontSizeScale: 100,
  proxy: DEFAULT_PROXY_SETTINGS,
  groupOrder: []
}

interface ThemePresetDefinition {
  label: string
  colors: ThemeColors
  darkColors: ThemeColors
}

export const THEME_PRESETS: Record<Exclude<ThemePreset, 'custom'>, ThemePresetDefinition> = {
  magpie: {
    label: 'defalut',
    colors: {
      background: '#FFFFFF',
      surface: '#F7F8FA',
      text: '#1F2328',
      accent: '#5C6BFF'
    },
    darkColors: {
      background: '#151619',
      surface: '#1E2025',
      text: '#F1F2F4',
      accent: '#8D98FF'
    }
  },
  warm: {
    label: '暖砂',
    colors: {
      background: '#F4F1EA',
      surface: '#FFFFFF',
      text: '#1B1E1C',
      accent: '#0E7567'
    },
    darkColors: {
      background: '#121416',
      surface: '#1D2023',
      text: '#F3F4F5',
      accent: '#5AC8B3'
    }
  },
  sage: {
    label: '鼠尾草',
    colors: {
      background: '#EEF1E9',
      surface: '#FFFFFF',
      text: '#1B211D',
      accent: '#4E735A'
    },
    darkColors: {
      background: '#121512',
      surface: '#1D221D',
      text: '#F1F3F0',
      accent: '#82AE8F'
    }
  },
  ocean: {
    label: '海盐',
    colors: {
      background: '#EEF2F3',
      surface: '#FFFFFF',
      text: '#171E21',
      accent: '#176B7A'
    },
    darkColors: {
      background: '#111619',
      surface: '#1C2327',
      text: '#EEF2F4',
      accent: '#56ACBA'
    }
  },
  rose: {
    label: '陶粉',
    colors: {
      background: '#F4EDEA',
      surface: '#FFFFFF',
      text: '#241B19',
      accent: '#9A4F55'
    },
    darkColors: {
      background: '#171214',
      surface: '#231C1F',
      text: '#F4EEED',
      accent: '#C98288'
    }
  }
}

export function resolveThemeColors(
  preset: ThemePreset,
  colorMode: ColorMode,
  customTheme: ThemeColors
): ThemeColors {
  if (preset === 'custom') {
    return colorMode === 'light'
      ? customTheme
      : {
          background: mixHex(customTheme.background, '#0B100E', 0.16),
          surface: mixHex(customTheme.surface, '#121A16', 0.24),
          text: mixHex(customTheme.text, '#F5F2EA', 0.84),
          accent: customTheme.accent
        }
  }

  return colorMode === 'dark'
    ? THEME_PRESETS[preset].darkColors
    : THEME_PRESETS[preset].colors
}

function mixHex(left: string, right: string, rightWeight: number): string {
  const leftRgb = parseHex(left)
  const rightRgb = parseHex(right)
  const weight = Math.max(0, Math.min(1, rightWeight))
  const channels = leftRgb.map((value, index) =>
    Math.round(value * (1 - weight) + rightRgb[index]! * weight)
      .toString(16)
      .padStart(2, '0')
  )
  return `#${channels.join('')}`.toUpperCase()
}

function parseHex(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16)
  ]
}
