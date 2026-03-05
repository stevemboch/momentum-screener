import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
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

Answer as JSON:
{
  "lastEarnings": {
    "date": string | null,
    "result": "beat" | "miss" | "inline" | null,
    "detail": string | null
  },
  "nextEarnings": string | null,
  "news": [{ "headline": string, "sentiment": "positive" | "negative" | "neutral" }],
  "macroRisk": string | null
}`

  try {
    const raw = await geminiSearchChat(systemPrompt, userMessage)
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
