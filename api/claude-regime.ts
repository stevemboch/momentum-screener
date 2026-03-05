import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openrouterChat, parseJSON } from './_openrouter'
import type { RegimeInputs } from '../src/utils/regimeInputs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const inputs: RegimeInputs = req.body
  if (!inputs || inputs.instrumentCount < 10)
    return res.status(400).json({ error: 'Zu wenig Instrumente (min. 10)' })

  const fmt = (v: number | null) =>
    v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`

  const systemPrompt = `Du bist ein quantitativer Marktanalyst. Du bekommst 
aggregierte Marktbreite-Kennzahlen eines Aktien/ETF-Universums und klassifizierst 
das aktuelle Marktregime. Antworte sachlich, präzise und auf Deutsch.
Antworte ausschließlich als valides JSON ohne Markdown-Backticks.`

  const userMessage =
`Marktbreite-Kennzahlen (${inputs.instrumentCount} Instrumente):
- Instrumente über MA200:            ${fmt(inputs.aboveMA200Pct)}
- Durchschnittlicher 3M-Return:      ${fmt(inputs.avgR3m)}
- Instrumente mit positivem 3M-Ret.: ${fmt(inputs.positiveR3mPct)}
- Durchschnittliche Volatilität:     ${fmt(inputs.avgVola)}
- MSCI World 3M-Return (Referenz):   ${fmt(inputs.urthR3m)}

Klassifiziere als genau eines von:
  RISK_ON     → breite Aufwärtsbewegung, Momentum intakt
  RISK_OFF    → Verkaufsdruck, breite Schwäche
  SIDEWAYS    → gemischtes Bild, keine klare Richtung
  TRANSITION  → Regime wechselt gerade

Antworte als JSON:
{
  "regime": "RISK_ON" | "RISK_OFF" | "SIDEWAYS" | "TRANSITION",
  "confidence": 0-100,
  "summary": "Ein Satz Begründung auf Deutsch",
  "suggestion": "Eine konkrete Gewichtungsempfehlung auf Deutsch"
}`

  try {
    const raw = await openrouterChat(systemPrompt, userMessage)
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
