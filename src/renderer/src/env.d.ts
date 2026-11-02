/// <reference types="vite/client" />

import type { AutologinApi } from '@shared/types'

declare global {
  interface Window {
    autologin: AutologinApi
  }
}

export {}
