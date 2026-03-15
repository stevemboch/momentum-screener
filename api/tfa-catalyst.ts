import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
  not_found: 0.0,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { ticker, name, drawFromHigh, drawFrom5YHigh, drawFrom7YHigh, scenario } = req.body
  if (!ticker || !name) return res.status(400).json({ error: 'ticker and name required' })

  const today = new Date().toISOString().split('T')[0]
  const d180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const drawPct =
    scenario === '7y' && drawFrom7YHigh != null ? Math.abs(drawFrom7YHigh * 100).toFixed(0)
    : scenario === '5y' && drawFrom5YHigh != null ? Math.abs(drawFrom5YHigh * 100).toFixed(0)
    : drawFromHigh != null ? Math.abs(drawFromHigh * 100).toFixed(0)
    : '?'

  const scenarioContext =
    scenario === '7y'
      ? `7-year structural deep-value candidate (${drawPct}% below 7Y high). Focus: new management, business model transformation, industry cycle turn, debt restructuring.`
      : scenario === '5y'
        ? `Multi-year turnaround candidate (${drawPct}% below 5Y high). Focus: cost restructuring, sector recovery, regulatory tailwinds, improved capital allocation.`
        : `Short-term reversal candidate (${drawPct}% below 52W high). Focus: earnings recovery, sector rotation, resolution of negative event.`

  const systemPrompt = `You are a quantitative turnaround analyst for European stocks.
Search for SPECIFIC VERIFIABLE FACTS only. Do NOT estimate or infer.
Search in both English AND German language sources.
For German stocks also search: "[company] Quartalsbericht", "[company] Insiderkauf BaFin",
"[company] Prognoseerhöhung", "[company] Analystenupgrade".
Answer exclusively as valid JSON, no markdown.`

  const userMessage = `
Stock: ${name} (Ticker: ${ticker})
Context: ${scenarioContext}
Analysis date: ${today}

Search for VERIFIABLE FACTS for each signal. Mark confidence:
- "high": found in primary source (earnings release, regulatory filing, official news)
- "medium": found in secondary source (analyst note, financial news summary)
- "low": found only as indirect reference
- "not_found": could not find evidence (this is NEUTRAL, not negative)

Search period: ${d180} to ${today} for earnings/guidance/restructuring
Search period: ${d90} to ${today} for upgrades and insider buying

SIGNAL 1 — earnings_beat_recent:
Search: "${ticker} earnings beat consensus" OR "${name} Quartalsergebnis übertroffen ${today.slice(0,4)}"
Did the MOST RECENT quarterly earnings beat analyst EPS consensus?

SIGNAL 2 — earnings_beat_prior:
Did the PRIOR quarter (one before the most recent) also beat EPS consensus?
Two consecutive beats = strong trend confirmation.

SIGNAL 3 — guidance_raised:
Search: "${name} raises guidance" OR "${name} Prognoseerhöhung" OR "${ticker} raises outlook"
Did the company raise full-year revenue or earnings guidance since ${d180}?

SIGNAL 4 — analyst_upgrade:
Search: "${name} analyst upgrade" OR "${name} Analystenupgrade" OR "${ticker} price target raised"
Has any analyst upgraded the stock or raised price target since ${d90}?

SIGNAL 5 — insider_buying:
Search: "${name} insider purchase" OR "${name} Insiderkauf BaFin" OR "${ticker} director buying"
Have company insiders (executives/board) purchased shares since ${d90}?

SIGNAL 6 — restructuring:
Search: "${name} restructuring" OR "${name} Restrukturierung" OR "${name} new CEO" OR "${name} strategic review"
Is there a credible restructuring, new CEO, or strategic pivot since ${d180}?

SIGNAL 7 — ko_risk:
Search: "${name} insolvency" OR "${name} Insolvenz" OR "${name} going concern" OR "${name} covenant breach"
Any signs of insolvency risk, going concern warning, or massive insider selling?

Return ONLY this JSON:
{
  "signals": {
    "earnings_beat_recent": { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "earnings_beat_prior":  { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "guidance_raised":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "analyst_upgrade":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "insider_buying":       { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "restructuring":        { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null" },
    "ko_risk":              { "value": true|false, "confidence": "high|medium|low|not_found", "source": "string|null" }
  },
  "summary": "2-3 sentences factual summary of key findings"
}`

  try {
    const raw = await geminiSearchChat(systemPrompt, userMessage)
    const result = parseJSON<any>(raw)
    const s = result.signals

    const koRisk = s?.ko_risk?.value === true && ['high', 'medium'].includes(s?.ko_risk?.confidence ?? '')

    const activeSignals = [
      'earnings_beat_recent',
      'earnings_beat_prior',
      'guidance_raised',
      'analyst_upgrade',
      'insider_buying',
      'restructuring',
    ] as const

    let sum = 0
    let count = 0
    for (const key of activeSignals) {
      const sig = s?.[key]
      if (!sig || sig.confidence === 'not_found') continue
      const conf = CONFIDENCE_WEIGHTS[sig.confidence] ?? 0
      sum += (sig.value ?? 0) * conf
      count++
    }

    const eScore = koRisk ? 0 : (count === 0 ? null : sum / count)

    return res.status(200).json({
      signals: s,
      eScore,
      koRisk,
      summary: result.summary ?? null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
