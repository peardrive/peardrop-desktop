/**
 * Renderer entry: install the client, apply the cached theme before first
 * paint, mount React, then boot (settings, library, engine events).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootApp } from './controllers/boot'
import { setClient } from './services/client'
import { applyCachedTheme } from './theme/ThemeProvider'
import './styles/index.css'

async function start() {
  if (window.peardrop) {
    setClient(window.peardrop)
  } else {
    // Plain browser (design work / screenshots): a simulated backend.
    const { createMockClient } = await import('./services/mock-client')
    setClient(createMockClient())
  }
  applyCachedTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
  await bootApp().catch((err) => console.error('[boot] failed', err))
}

void start()
