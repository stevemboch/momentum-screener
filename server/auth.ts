import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'

const DEFAULT_COOKIE_NAME = 'ms_auth'
const DEFAULT_SESSION_TTL_HOURS = 24
const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

interface SessionPayload {
  exp: number
}

interface LoginAttempt {
  windowStartedAt: number
  count: number
  blockedUntil: number
}

const loginAttempts = new Map<string, LoginAttempt>()

function nowMs(): number {
  return Date.now()
}

function authCookieName(): string {
  return process.env.APP_AUTH_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME
}

function sessionTtlHours(): number {
  const raw = Number(process.env.APP_AUTH_TTL_HOURS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SESSION_TTL_HOURS
  return Math.min(Math.floor(raw), 24 * 30)
}

function sessionSecret(): string {
  return process.env.APP_AUTH_SESSION_SECRET || ''
}

function configuredPassword(): string {
  return process.env.APP_AUTH_PASSWORD || ''
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production'
}

function sha256(input: string): Buffer {
  return crypto.createHash('sha256').update(input, 'utf8').digest()
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ah = sha256(a)
  const bh = sha256(b)
  return crypto.timingSafeEqual(ah, bh)
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

function appendSetCookie(res: VercelResponse, cookie: string) {
  const prev = res.getHeader('Set-Cookie')
  if (!prev) {
    res.setHeader('Set-Cookie', cookie)
    return
  }
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookie])
    return
  }
  res.setHeader('Set-Cookie', [String(prev), cookie])
}

function serializeSessionCookie(value: string, maxAgeSec: number): string {
  const parts = [
    `${authCookieName()}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ]
  if (isSecureCookie()) parts.push('Secure')
  return parts.join('; ')
}

function serializeExpiredCookie(): string {
  const parts = [
    `${authCookieName()}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  if (isSecureCookie()) parts.push('Secure')
  return parts.join('; ')
}

function parseCookieHeader(req: VercelRequest): Record<string, string> {
  const raw = req.headers.cookie
  if (!raw) return {}
  const joined = Array.isArray(raw) ? raw.join(';') : raw
  return joined.split(';').reduce<Record<string, string>>((acc, part) => {
    const idx = part.indexOf('=')
    if (idx < 0) return acc
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) return acc
    acc[key] = value
    return acc
  }, {})
}

function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeSession(value: string): SessionPayload | null {
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const exp = Number((parsed as { exp?: number }).exp)
    if (!Number.isFinite(exp)) return null
    return { exp }
  } catch {
    return null
  }
}

function clientKey(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  if (Array.isArray(forwarded) && forwarded[0]?.trim()) {
    return forwarded[0].split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

function pruneLoginAttempts(now: number) {
  for (const [key, attempt] of loginAttempts) {
    const stale = now - attempt.windowStartedAt > LOGIN_WINDOW_MS && now > attempt.blockedUntil
    if (stale) loginAttempts.delete(key)
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(configuredPassword() && sessionSecret())
}

export function verifyPassword(input: string): boolean {
  const expected = configuredPassword()
  if (!expected || !sessionSecret()) return false
  return timingSafeEqualString(input, expected)
}

export function isLoginThrottled(req: VercelRequest): boolean {
  const now = nowMs()
  pruneLoginAttempts(now)
  const attempt = loginAttempts.get(clientKey(req))
  if (!attempt) return false
  return attempt.blockedUntil > now
}

export function registerLoginFailure(req: VercelRequest) {
  const now = nowMs()
  pruneLoginAttempts(now)
  const key = clientKey(req)
  const current = loginAttempts.get(key)

  if (!current || now - current.windowStartedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, {
      windowStartedAt: now,
      count: 1,
      blockedUntil: 0,
    })
    return
  }

  current.count += 1
  if (current.count >= LOGIN_LIMIT) {
    current.blockedUntil = now + LOGIN_WINDOW_MS
  }
  loginAttempts.set(key, current)
}

export function clearLoginThrottle(req: VercelRequest) {
  loginAttempts.delete(clientKey(req))
}

export function getSession(req: VercelRequest): SessionPayload | null {
  const secret = sessionSecret()
  if (!secret) return null

  const cookieValue = parseCookieHeader(req)[authCookieName()]
  if (!cookieValue) return null

  let decodedCookie = ''
  try {
    decodedCookie = decodeURIComponent(cookieValue)
  } catch {
    return null
  }
  const [payloadPart, sigPart] = decodedCookie.split('.')
  if (!payloadPart || !sigPart) return null

  const expectedSig = sign(payloadPart, secret)
  if (!timingSafeEqualString(sigPart, expectedSig)) return null

  const payload = decodeSession(payloadPart)
  if (!payload) return null
  if (payload.exp <= nowMs()) return null
  return payload
}

export function issueSession(res: VercelResponse) {
  const secret = sessionSecret()
  if (!secret) throw new Error('APP_AUTH_SESSION_SECRET not configured')
  const maxAgeSec = sessionTtlHours() * 60 * 60
  const payload: SessionPayload = { exp: nowMs() + maxAgeSec * 1000 }
  const encoded = encodeSession(payload)
  const signature = sign(encoded, secret)
  appendSetCookie(res, serializeSessionCookie(`${encoded}.${signature}`, maxAgeSec))
}

export function clearSession(res: VercelResponse) {
  appendSetCookie(res, serializeExpiredCookie())
}

export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  if (getSession(req)) return true
  res.status(401).json({ error: 'Unauthorized' })
  return false
}
