import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  clearLoginThrottle,
  clearSession,
  getSession,
  isAuthConfigured,
  isLoginThrottled,
  issueSession,
  registerLoginFailure,
  verifyPassword,
} from '../../server/auth'

function invalidCredentials(res: VercelResponse) {
  return res.status(401).json({ error: 'Invalid credentials' })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query?.action || '').toLowerCase()

  if (action === 'session') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    if (!isAuthConfigured()) return res.status(200).json({ authenticated: false })
    return res.status(200).json({ authenticated: Boolean(getSession(req)) })
  }

  if (action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    clearSession(res)
    return res.status(200).json({ ok: true })
  }

  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!isAuthConfigured()) {
      return res.status(500).json({ error: 'Auth is not configured' })
    }
    if (isLoginThrottled(req)) return invalidCredentials(res)

    const password = req.body?.password
    if (typeof password !== 'string' || password.length === 0) {
      registerLoginFailure(req)
      return invalidCredentials(res)
    }
    if (!verifyPassword(password)) {
      registerLoginFailure(req)
      return invalidCredentials(res)
    }

    clearLoginThrottle(req)
    issueSession(res)
    return res.status(200).json({ ok: true })
  }

  return res.status(404).json({ error: 'Not found' })
}
