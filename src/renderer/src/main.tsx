import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './lib/i18n'
import App from './App'
import { resolveTheme } from './store/app'

// Thème du système en attendant les réglages : pas d'éclair sombre au démarrage en thème clair.
document.documentElement.dataset.theme = resolveTheme('system')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
