import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'
import { requireAuth } from './_auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  const { instruments } = req.body
  if (!Array.isArray(instruments) || instruments.length === 0)
    return res.status(400).json({ error: 'instruments array required' })

  const systemPrompt = `You are an independent financial analyst focused on 
momentum strategies. You receive a portfolio and must research current market 
developments relevant to these specific positions using web search.

Respond exclusively in English. Be precise and factual.
No disclaimers, no introductions, no filler phrases.
Respond exclusively as valid JSON without Markdown backticks.`

  const userMessage =
`Portfolio positions:
${JSON.stringify(instruments, null, 2)}

Search for recent developments (last 2-4 weeks) directly relevant to these 
specific positions. Focus on:
1. News that could threaten or confirm the current momentum of any position
2. Macro events affecting multiple positions simultaneously
   (e.g. interest rate moves, currency shifts, sector rotation signals)
3. Significant analyst rating changes or earnings surprises
4. Any position-specific risks that have emerged recently

Prioritise findings by relevance and urgency.
Skip generic market commentary.
Name specific instruments from the portfolio in each finding.

Return as JSON:
{
  "findings": [
    {
      "priority": "high" | "medium" | "low",
      "instruments": ["name1", "name2"],
      "headline": "One-line summary",
      "detail": "2-3 sentences of context and implication for the position",
      "sentiment": "positive" | "negative" | "neutral"
    }
  ],
  "macroContext": "1-2 sentences on the broader market environment 
                   relevant to this portfolio as a whole",
  "generatedAt": "${new Date().toISOString()}"
}

Maximum 5 findings. Sort by priority (high first).`

  try {
    const raw = await geminiSearchChat(systemPrompt, userMessage)
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
