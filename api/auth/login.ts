import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  clearLoginThrottle,
  isAuthConfigured,
  isLoginThrottled,
  issueSession,
  registerLoginFailure,
  verifyPassword,
} from '../_auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Auth is not configured' })
  }

  if (isLoginThrottled(req)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const password = req.body?.password
  if (typeof password !== 'string' || password.length === 0) {
    registerLoginFailure(req)
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  if (!verifyPassword(password)) {
    registerLoginFailure(req)
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  clearLoginThrottle(req)
  issueSession(res)
  return res.status(200).json({ ok: true })
}
