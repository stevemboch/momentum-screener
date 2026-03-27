import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from '../server/gemini'
import { requireAuth } from '../server/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const { ticker, name, lastPrice, targetPrice } = req.body
  if (!ticker || !name) return res.status(400).json({ error: 'ticker und name required' })

  const systemPrompt = `You are a financial analyst. Search for up-to-date 
information about a listed instrument and create a compact context brief.
Answer in English only. Be factual and concise.
Answer exclusively as valid JSON without Markdown backticks.`

  const userMessage =
`Instrument: ${name} (Ticker: ${ticker})
Last price: ${lastPrice != null ? lastPrice : 'unknown'}
Analyst target price: ${targetPrice != null ? targetPrice : 'unknown'}

Search for:
1. The last earnings (date and beat/miss/inline vs consensus, short explanation)
2. The next earnings date if known
3. Up to 2 relevant recent news headlines (last 4 weeks)
4. One currently relevant macro or sector risk
5. Bankruptcy risk assessment (last 12 months):
   Check for insolvency filing/proceedings, going-concern warnings, debt restructuring,
   covenant breaches, or acute liquidity stress.
   Return risk level: low | medium | high.
   Include up to 3 concrete signals with date.
6. Financial health assessment (based on latest reported data):
   Assess leverage, liquidity, interest coverage, free cash flow trend, and profitability trend.
   Return status: healthy | watch | stressed.
   Provide a short factual rationale.

Important:
- If reliable data is unavailable, return null fields and state "insufficient data".
- Do not infer insolvency risk from price action alone.

Answer as JSON:
{
  "lastEarnings": {
    "date": string | null,
    "result": "beat" | "miss" | "inline" | null,
    "detail": string | null
  },
  "nextEarnings": string | null,
  "news": [{ "headline": string, "sentiment": "positive" | "negative" | "neutral" }],
  "macroRisk": string | null,
  "bankruptcyRisk": {
    "level": "low" | "medium" | "high" | null,
    "signals": string[],
    "detail": string | null
  },
  "financialHealth": {
    "status": "healthy" | "watch" | "stressed" | null,
    "detail": string | null
  }
}`

  try {
    const raw = await geminiSearchChat(systemPrompt, userMessage)
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
