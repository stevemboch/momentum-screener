import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { ticker, name, drawFromHigh } = req.body

  const systemPrompt = `You are a turnaround investment analyst. 
Search for current information about a stock that has fallen significantly.
Assess if there are catalysts for a recovery. Answer as valid JSON only.`

  const userMessage =
`Stock: ${name} (${ticker})
Current drawdown from 52W high: ${drawFromHigh != null ? (drawFromHigh * 100).toFixed(1) + '%' : 'unknown'}

Search and evaluate these turnaround catalysts (each 0=absent, 0.5=weak, 1=strong):

1. insider_buying: Recent insider purchases (last 90 days)?
2. short_squeeze: Short interest > 10%? High borrow costs?
3. restructuring: New management, cost cuts, or strategic pivot announced?
4. sector_catalyst: Positive regulatory or macro shift for this sector?
5. ko_risk: Signs of insolvency risk, massive insider selling, or accounting issues?

Answer as JSON:
{
  "insider_buying": 0 | 0.5 | 1,
  "short_squeeze": 0 | 0.5 | 1,
  "restructuring": 0 | 0.5 | 1,
  "sector_catalyst": 0 | 0.5 | 1,
  "ko_risk": true | false,
  "eScore": number,
  "summary": string
}`

  try {
    const raw = await geminiSearchChat(systemPrompt, userMessage)
    const result = parseJSON<any>(raw)
    // Endgültigen tfaScore berechnen wenn ko_risk = false
    if (!result.ko_risk) {
      result.eScore = (result.insider_buying + result.short_squeeze +
                       result.restructuring + result.sector_catalyst) / 4
    } else {
      result.eScore = 0
    }
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
