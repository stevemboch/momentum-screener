import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSession, isAuthConfigured } from '../_auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAuthConfigured()) return res.status(200).json({ authenticated: false })
  return res.status(200).json({ authenticated: Boolean(getSession(req)) })
}
