import type {
  AppSettings,
  ColorMode,
  ThemeColors,
  ThemePreset
} from './types'

export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#F4F1EA',
  surface: '#FBF9F4',
  text: '#1C2521',
  accent: '#0E7567'
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoLockMinutes: 10,
  colorMode: 'light',
  language: 'zh-CN',
  themePreset: 'warm',
  customTheme: DEFAULT_THEME_COLORS,
  interfaceScale: 100
}

interface ThemePresetDefinition {
  label: string
  colors: ThemeColors
  darkColors: ThemeColors
}

export const THEME_PRESETS: Record<Exclude<ThemePreset, 'custom'>, ThemePresetDefinition> = {
  warm: {
    label: '暖砂',
    colors: DEFAULT_THEME_COLORS,
    darkColors: {
      background: '#111714',
      surface: '#18211D',
      text: '#F2EEE4',
      accent: '#4DB8A4'
    }
  },
  sage: {
    label: '鼠尾草',
    colors: {
      background: '#EEF1E9',
      surface: '#F8FAF4',
      text: '#1E2921',
      accent: '#4E735A'
    },
    darkColors: {
      background: '#101710',
      surface: '#172017',
      text: '#EFF3EA',
      accent: '#82AE8F'
    }
  },
  ocean: {
    label: '海盐',
    colors: {
      background: '#EEF2F3',
      surface: '#F8FAFA',
      text: '#17262B',
      accent: '#176B7A'
    },
    darkColors: {
      background: '#0D171A',
      surface: '#142126',
      text: '#EAF2F3',
      accent: '#56ACBA'
    }
  },
  rose: {
    label: '陶粉',
    colors: {
      background: '#F4EDEA',
      surface: '#FCF8F5',
      text: '#2B211F',
      accent: '#9A4F55'
    },
    darkColors: {
      background: '#1A1213',
      surface: '#241A1C',
      text: '#F5EBE8',
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
