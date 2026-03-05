import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openrouterChat, parseJSON } from './_openrouter'
import type { RegimeInputs } from '../src/utils/regimeInputs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const inputs: RegimeInputs = req.body
  if (!inputs || inputs.instrumentCount < 10)
    return res.status(400).json({ error: 'Not enough instruments (min. 10)' })

  const fmt = (v: number | null) =>
    v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`

  const systemPrompt = `You are a quantitative market analyst. You receive 
aggregated market-breadth metrics for an equity/ETF universe and classify 
the current market regime. Answer clearly and concisely in English.
Answer exclusively as valid JSON without Markdown backticks.`

  const userMessage =
`Market breadth metrics (${inputs.instrumentCount} instruments):
- Instruments above MA200:          ${fmt(inputs.aboveMA200Pct)}
- Average 3M return:                ${fmt(inputs.avgR3m)}
- Instruments with positive 3M ret: ${fmt(inputs.positiveR3mPct)}
- Average volatility:               ${fmt(inputs.avgVola)}
- MSCI World 3M return (reference): ${fmt(inputs.urthR3m)}

Classify as exactly one of:
  RISK_ON     → broad uptrend, momentum intact
  RISK_OFF    → selling pressure, broad weakness
  SIDEWAYS    → mixed signals, no clear direction
  TRANSITION  → regime is shifting

Answer as JSON:
{
  "regime": "RISK_ON" | "RISK_OFF" | "SIDEWAYS" | "TRANSITION",
  "confidence": 0-100,
  "summary": "One-sentence rationale in English",
  "suggestion": "One concrete allocation suggestion in English"
}`

  try {
    const raw = await openrouterChat(systemPrompt, userMessage)
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
