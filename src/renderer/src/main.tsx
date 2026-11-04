import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applySkin } from './lib/skins'
import './index.css'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

window.rally
  .getConfig()
  .then((config) => applySkin(config.skin))
  .finally(render)
