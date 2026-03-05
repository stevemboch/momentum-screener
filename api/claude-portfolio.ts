import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openrouterChat, parseJSON } from './_openrouter'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { instruments } = req.body
  if (!Array.isArray(instruments) || instruments.length === 0)
    return res.status(400).json({ error: 'instruments array required' })

  const systemPrompt = `Du bist ein quantitativer Portfolio-Analyst. Du bekommst 
eine Liste von Instrumenten mit Exposure- und Momentum-Daten. Analysiere das 
Portfolio auf:
1. Klumpenrisiken (Region/Sektor/Faktor die >40% des Portfolios ausmachen)
2. Momentum-Konzentration (korreliertes Drawdown-Risiko wenn alle gleichzeitig fallen)
3. Stil-Imbalance (nur Momentum, kein Value oder umgekehrt)
4. Redundanz (sehr ähnlicher Exposure doppelt gehalten)
Sei präzise und nenne konkrete Instrumentennamen. Kein Disclaimer, keine Einleitung.
Maximal 4 findings. Antworte auf Deutsch.
Antworte ausschließlich als valides JSON ohne Markdown-Backticks:
{ "severity": "ok" | "warning" | "critical", "findings": ["string"] }`

  try {
    const raw = await openrouterChat(systemPrompt, JSON.stringify(instruments, null, 2))
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
