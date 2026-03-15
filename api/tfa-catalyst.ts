import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { ticker, name, drawFromHigh, drawFrom5YHigh, drawFrom7YHigh, scenario } = req.body

  const scenarioDescription = scenario === '7y'
    ? `This is a STRUCTURAL DEEP-VALUE candidate. The stock is ${
      drawFrom7YHigh != null ? Math.abs(drawFrom7YHigh * 100).toFixed(0) + '%' : 'significantly'
    } below its 7-year high and has been underperforming for years.
Focus on structural recovery catalysts: new management, business model transformation,
industry cycle turn, major debt restructuring, or strategic asset sales.`
    : scenario === '5y'
      ? `This is a MULTI-YEAR turnaround candidate. The stock is ${
        drawFrom5YHigh != null ? Math.abs(drawFrom5YHigh * 100).toFixed(0) + '%' : 'significantly'
      } below its 5-year high and has been in a prolonged downtrend.
Focus on medium-term catalysts: new management, cost restructuring,
sector recovery, regulatory tailwinds, or improved capital allocation.`
      : `This is a SHORT-TERM reversal candidate. The stock has fallen ${
        drawFromHigh != null ? Math.abs(drawFromHigh * 100).toFixed(0) + '%' : 'sharply'
      } from its 52-week high.
Focus on near-term catalysts: earnings recovery, short squeeze potential,
sector rotation, or resolution of a specific negative event.`

  const systemPrompt = `You are a turnaround investment analyst.
Search for current information about a stock that has significantly underperformed.
Assess whether credible catalysts exist for a recovery. Answer as valid JSON only.`

  const userMessage =
`Stock: ${name} (${ticker})
${scenarioDescription}

Evaluate these turnaround catalysts (each 0=absent, 0.5=weak signal, 1=strong signal):

1. insider_buying: Recent insider purchases in the last 90 days?
2. short_squeeze: Short interest above 10%? High borrow costs or squeeze potential?
3. restructuring: New management, cost cuts, spin-off, or strategic pivot announced?
4. sector_catalyst: Positive regulatory change, macro tailwind, or industry cycle turn?
5. ko_risk: Any signs of insolvency risk, covenant breach, massive insider selling, or accounting issues?

Answer as JSON:
{
  "insider_buying": 0 | 0.5 | 1,
  "short_squeeze": 0 | 0.5 | 1,
  "restructuring": 0 | 0.5 | 1,
  "sector_catalyst": 0 | 0.5 | 1,
  "ko_risk": true | false,
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
