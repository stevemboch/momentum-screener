import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'

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

const BATCH_SIZE = 100
const FETCH_TIMEOUT_MS = 10_000
const MAX_RETRIES = 1
const RETRY_BASE_DELAY_MS = 400

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withBatchLength<T>(arr: T[], expectedLength: number, fill: T): T[] {
  const out: T[] = new Array(expectedLength).fill(fill)
  for (let i = 0; i < expectedLength; i++) {
    if (i < arr.length && arr[i] != null) out[i] = arr[i]
  }
  return out
}

async function fetchOpenFigiBatch(batch: FigiJob[], apiKey: string): Promise<any[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch('https://api.openfigi.com/v3/mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OPENFIGI-APIKEY': apiKey,
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`OpenFIGI error ${response.status}:`, text)
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
          continue
        }
        return new Array(batch.length).fill(null)
      }

      const parsed = await response.json().catch(() => null)
      const rows = Array.isArray(parsed) ? parsed : []
      return withBatchLength(rows, batch.length, null)
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError'
      console.error(`OpenFIGI batch error${isTimeout ? ' (timeout)' : ''}:`, err)
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
        continue
      }
      return new Array(batch.length).fill(null)
    } finally {
      clearTimeout(timeout)
    }
  }
  return new Array(batch.length).fill(null)
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

  const allResults: any[] = []

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)

    try {
      const data = await fetchOpenFigiBatch(batch, apiKey)

      // For each result, pick the best match
      for (const result of data) {
        if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) {
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
