import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AppStateProvider } from './state/AppState'
import { UiPrefsProvider } from './state/UiPrefs'
import { ErrorBoundary } from './components/ErrorBoundary'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary panelName="PumpGuard DT">
      <BrowserRouter>
        <UiPrefsProvider>
          <AppStateProvider>
            <App />
          </AppStateProvider>
        </UiPrefsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
