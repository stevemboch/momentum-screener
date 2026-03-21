import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

export function AuthGate() {
  const { status, error, login } = useAuth()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const loading = status === 'loading'
  const disabled = loading || submitting || !password.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (disabled) return
    setSubmitting(true)
    setLocalError(null)
    const ok = await login(password)
    if (!ok) setLocalError('Ungueltiges Passwort')
    setSubmitting(false)
    if (ok) setPassword('')
  }

  return (
    <div className="h-screen bg-bg text-gray-200 flex items-center justify-center px-4">
      <div className="w-full max-w-sm border border-border bg-surface rounded-lg p-6 shadow-2xl">
        <div className="font-mono text-sm font-semibold tracking-wider text-gray-100 mb-1">
          MOMENTUM<span className="text-accent">_</span>SCREENER
        </div>
        <div className="text-xs font-mono text-muted mb-5">
          Authentication required
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            autoFocus
            className="bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-gray-200 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={disabled}
            className="px-3 py-2 text-sm font-mono rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading || submitting ? 'Pruefe…' : 'Einloggen'}
          </button>
        </form>

        {(localError || error) && (
          <div className="mt-3 text-xs font-mono text-red-400">
            {localError || error}
          </div>
        )}
      </div>
    </div>
  )
}
