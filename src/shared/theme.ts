import type { ThemeColors, ThemePreset } from './types'

export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#F4F1EA',
  surface: '#FBF9F4',
  text: '#1C2521',
  accent: '#0E7567'
}

export const THEME_PRESETS: Record<
  Exclude<ThemePreset, 'custom'>,
  { label: string; colors: ThemeColors }
> = {
  warm: {
    label: '暖砂',
    colors: DEFAULT_THEME_COLORS
  },
  sage: {
    label: '鼠尾草',
    colors: {
      background: '#EEF1E9',
      surface: '#F8FAF4',
      text: '#1E2921',
      accent: '#4E735A'
    }
  },
  ocean: {
    label: '海盐',
    colors: {
      background: '#EEF2F3',
      surface: '#F8FAFA',
      text: '#17262B',
      accent: '#176B7A'
    }
  },
  rose: {
    label: '陶粉',
    colors: {
      background: '#F4EDEA',
      surface: '#FCF8F5',
      text: '#2B211F',
      accent: '#9A4F55'
    }
  }
}
