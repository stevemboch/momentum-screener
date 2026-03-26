import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './store'
import { AuthProvider } from './auth/AuthProvider'
import App from './App'
import './index.css'

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] uncaught render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface text-text p-6">
          <div className="max-w-3xl mx-auto rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <h1 className="text-lg font-semibold text-red-300">UI Runtime Error</h1>
            <p className="mt-2 text-sm text-red-100">
              Beim Rendern ist ein Fehler aufgetreten. Bitte Seite neu laden. Wenn es erneut passiert,
              sende die erste rote Meldung aus der Konsole.
            </p>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-red-100/90">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </RootErrorBoundary>
  </StrictMode>
)
