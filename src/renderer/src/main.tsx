import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import '@fontsource/noto-sans-sc/chinese-simplified-500.css'
import '@fontsource/noto-sans-sc/chinese-simplified-600.css'
import '@fontsource/noto-sans-sc/chinese-simplified-700.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTauriAutologinApi } from './tauri-api'

installTauriAutologinApi()
createRoot(document.getElementById('root')!).render(<App />)
