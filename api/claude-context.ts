import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChat, parseJSON } from './_gemini'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { ticker, name, lastPrice, targetPrice } = req.body
  if (!ticker || !name) return res.status(400).json({ error: 'ticker und name required' })

  const systemPrompt = `Du bist ein Finanzanalyst. Suche nach aktuellen 
Informationen zu einem Börseninstrument und erstelle einen kompakten Kontext-Brief.
Antworte ausschließlich auf Deutsch. Sei faktisch und knapp.
Antworte ausschließlich als valides JSON ohne Markdown-Backticks.`

  const userMessage =
`Instrument: ${name} (Ticker: ${ticker})
Aktueller Kurs: ${lastPrice != null ? lastPrice : 'unbekannt'}
Analyst-Kursziel: ${targetPrice != null ? targetPrice : 'unbekannt'}

Suche nach:
1. Den letzten Earnings (Datum und ob Beat/Miss/In-line vs. Konsens, kurze Erläuterung)
2. Dem nächsten Earnings-Termin falls bekannt
3. Maximal 2 relevanten aktuellen News-Schlagzeilen (letzte 4 Wochen)
4. Einem Makro- oder Sektor-Risiko das aktuell relevant ist

Antworte als JSON:
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
