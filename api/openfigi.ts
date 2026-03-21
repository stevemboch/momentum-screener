import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from './_auth'

interface FigiJob {
  idType: string
  idValue: string
  exchCode?: string
}

interface FigiResult {
  figi?: string
  isin?: string
  name?: string
  securityDescription?: string
  ticker?: string
  exchCode?: string
  securityType?: string
  securityType2?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  const jobs: FigiJob[] = req.body
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  const apiKey = process.env.OPENFIGI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OpenFIGI API key not configured' })

  // Process in batches of 100 (OpenFIGI limit)
  const BATCH_SIZE = 100
  const allResults: any[] = []

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)

    try {
      const response = await fetch('https://api.openfigi.com/v3/mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OPENFIGI-APIKEY': apiKey,
        },
        body: JSON.stringify(batch),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`OpenFIGI error ${response.status}:`, text)
        // Push nulls for failed batch
        for (let j = 0; j < batch.length; j++) allResults.push(null)
        continue
      }

      const data = await response.json()

      // For each result, pick the best match
      for (const result of data) {
        if (!result.data || result.data.length === 0) {
          allResults.push(null)
          continue
        }

        const matches: FigiResult[] = result.data

        // Selection priority:
        // 1. ETF/ETC securityType2 matches
        // 2. Prefer exchCode GS (Xetra)
        // 3. Fall back to first result
        const etfMatches = matches.filter(
          (m) =>
            m.securityType2 === 'ETF' ||
            m.securityType2 === 'ETC' ||
            m.securityType === 'ETP' ||
            m.securityType2 === 'Exchange Traded Fund'
        )

        const xetrMatch =
          etfMatches.find((m) => m.exchCode === 'GS') ||
          etfMatches[0] ||
          matches.find((m) => m.exchCode === 'GS') ||
          matches[0]

        // If the chosen match has no ISIN, try to find any match that does.
        const withIsin =
          etfMatches.find((m) => m.isin) ||
          matches.find((m) => m.isin) ||
          xetrMatch

        const pick = xetrMatch?.isin ? xetrMatch : withIsin

        allResults.push({
          name: pick?.name || null,
          securityDescription: pick?.securityDescription || null,
          isin: pick?.isin || null,
          ticker: pick?.ticker || null,
          securityType: pick?.securityType || null,
          securityType2: pick?.securityType2 || null,
          exchCode: pick?.exchCode || null,
        })
      }
    } catch (err) {
      console.error('OpenFIGI batch error:', err)
      for (let j = 0; j < batch.length; j++) allResults.push(null)
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < jobs.length) {
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  return res.status(200).json(allResults)
}
