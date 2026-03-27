import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChatWithMeta, parseJSONWithRepair } from '../server/gemini'
import { requireAuth } from '../server/auth'

type SourceType = 'primary' | 'regulatory' | 'major_media' | 'secondary'
type Confidence = 'high' | 'medium' | 'low'
type DataQuality = 'high' | 'medium' | 'low'
type RiskLevel = 'low' | 'medium' | 'high'
type HealthStatus = 'healthy' | 'watch' | 'stressed'

interface EvidenceItem {
  sourceName: string | null
  sourceType: SourceType
  url: string | null
  publishedAt: string | null
  confidence: Confidence
  confidenceReason: string | null
}

interface ContextResponse {
  lastEarnings: {
    date: string | null
    result: 'beat' | 'miss' | 'inline' | null
    detail: string | null
  } | null
  nextEarnings: string | null
  news: { headline: string; sentiment: 'positive' | 'negative' | 'neutral' }[]
  macroRisk: string | null
  macroRiskEvidence: EvidenceItem[]
  macroRiskInsufficientEvidenceReason: string | null
  bankruptcyRisk: {
    level: RiskLevel | null
    signals: string[]
    detail: string | null
    evidence: EvidenceItem[]
    insufficientEvidenceReason: string | null
  } | null
  financialHealth: {
    status: HealthStatus | null
    detail: string | null
    evidence: EvidenceItem[]
    insufficientEvidenceReason: string | null
  } | null
  asOf: string
  searchWindow: { from: string; to: string }
  dataQuality: DataQuality
}

const CONTEXT_SCHEMA_HINT = `{
  "lastEarnings": {
    "date": "YYYY-MM-DD|null",
    "result": "beat|miss|inline|null",
    "detail": "string|null"
  },
  "nextEarnings": "string|null",
  "news": [{ "headline": "string", "sentiment": "positive|negative|neutral" }],
  "macroRisk": "string|null",
  "macroRiskEvidence": [{
    "sourceName": "string|null",
    "sourceType": "primary|regulatory|major_media|secondary",
    "url": "string|null",
    "publishedAt": "YYYY-MM-DD|null",
    "confidence": "high|medium|low",
    "confidenceReason": "string|null"
  }],
  "macroRiskInsufficientEvidenceReason": "string|null",
  "bankruptcyRisk": {
    "level": "low|medium|high|null",
    "signals": ["string"],
    "detail": "string|null",
    "evidence": [{
      "sourceName": "string|null",
      "sourceType": "primary|regulatory|major_media|secondary",
      "url": "string|null",
      "publishedAt": "YYYY-MM-DD|null",
      "confidence": "high|medium|low",
      "confidenceReason": "string|null"
    }],
    "insufficientEvidenceReason": "string|null"
  },
  "financialHealth": {
    "status": "healthy|watch|stressed|null",
    "detail": "string|null",
    "evidence": [{
      "sourceName": "string|null",
      "sourceType": "primary|regulatory|major_media|secondary",
      "url": "string|null",
      "publishedAt": "YYYY-MM-DD|null",
      "confidence": "high|medium|low",
      "confidenceReason": "string|null"
    }],
    "insufficientEvidenceReason": "string|null"
  },
  "asOf": "ISO-8601",
  "searchWindow": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "dataQuality": "high|medium|low"
}`

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const cleaned = v.trim()
  return cleaned.length > 0 ? cleaned : null
}

function asDataQuality(v: unknown): DataQuality | null {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return null
}

function asSourceType(v: unknown): SourceType {
  if (v === 'primary' || v === 'regulatory' || v === 'major_media' || v === 'secondary') return v
  return 'secondary'
}

function asConfidence(v: unknown): Confidence {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function normalizeEvidence(v: unknown): EvidenceItem | null {
  if (!v || typeof v !== 'object') return null
  const src = v as any
  return {
    sourceName: asString(src.sourceName),
    sourceType: asSourceType(src.sourceType),
    url: asString(src.url),
    publishedAt: asString(src.publishedAt),
    confidence: asConfidence(src.confidence),
    confidenceReason: asString(src.confidenceReason),
  }
}

function normalizeEvidenceList(v: unknown): EvidenceItem[] {
  if (!Array.isArray(v)) return []
  return v.map(normalizeEvidence).filter(Boolean).slice(0, 3) as EvidenceItem[]
}

function asRiskLevel(v: unknown): RiskLevel | null {
  if (v === 'low' || v === 'medium' || v === 'high') return v
  return null
}

function asHealthStatus(v: unknown): HealthStatus | null {
  if (v === 'healthy' || v === 'watch' || v === 'stressed') return v
  return null
}

function countEvidence(response: ContextResponse): number {
  return (
    response.macroRiskEvidence.length
    + (response.bankruptcyRisk?.evidence.length ?? 0)
    + (response.financialHealth?.evidence.length ?? 0)
  )
}

function deriveDataQuality(proposed: DataQuality | null, evidenceCount: number): DataQuality {
  if (proposed) return proposed
  if (evidenceCount >= 4) return 'high'
  if (evidenceCount >= 2) return 'medium'
  return 'low'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const { ticker, name, lastPrice, targetPrice } = req.body
  if (!ticker || !name) return res.status(400).json({ error: 'ticker und name required' })

  const nowIso = new Date().toISOString()
  const today = nowIso.split('T')[0]
  const from = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const systemPrompt = `You are a financial analyst. Search for up-to-date 
information about a listed instrument and create a compact context brief.
Answer in English only. Be factual and concise.
Follow this strict protocol:
1) Use ticker+name to avoid entity mix-ups.
2) Use absolute dates and keep evidence inside the requested window when possible.
3) Source hierarchy: primary/regulatory > major_media > secondary.
4) No hard claim without evidence. If evidence is weak, return insufficientEvidenceReason.
5) If sources conflict, report the conflict and lower confidence.
Answer exclusively as valid JSON without Markdown backticks.`

  const userMessage =
`Instrument: ${name} (Ticker: ${ticker})
Last price: ${lastPrice != null ? lastPrice : 'unknown'}
Analyst target price: ${targetPrice != null ? targetPrice : 'unknown'}
Analysis date: ${today}
Search window: ${from} to ${today}

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
  "macroRiskEvidence": [
    {
      "sourceName": string | null,
      "sourceType": "primary" | "regulatory" | "major_media" | "secondary",
      "url": string | null,
      "publishedAt": string | null,
      "confidence": "high" | "medium" | "low",
      "confidenceReason": string | null
    }
  ],
  "macroRiskInsufficientEvidenceReason": string | null,
  "bankruptcyRisk": {
    "level": "low" | "medium" | "high" | null,
    "signals": string[],
    "detail": string | null,
    "evidence": [
      {
        "sourceName": string | null,
        "sourceType": "primary" | "regulatory" | "major_media" | "secondary",
        "url": string | null,
        "publishedAt": string | null,
        "confidence": "high" | "medium" | "low",
        "confidenceReason": string | null
      }
    ],
    "insufficientEvidenceReason": string | null
  },
  "financialHealth": {
    "status": "healthy" | "watch" | "stressed" | null,
    "detail": string | null,
    "evidence": [
      {
        "sourceName": string | null,
        "sourceType": "primary" | "regulatory" | "major_media" | "secondary",
        "url": string | null,
        "publishedAt": string | null,
        "confidence": "high" | "medium" | "low",
        "confidenceReason": string | null
      }
    ],
    "insufficientEvidenceReason": string | null
  },
  "asOf": "${nowIso}",
  "searchWindow": { "from": "${from}", "to": "${today}" },
  "dataQuality": "high" | "medium" | "low"
}`

  try {
    const search = await geminiSearchChatWithMeta(systemPrompt, userMessage)
    const parsed = await parseJSONWithRepair<any>(search.text, CONTEXT_SCHEMA_HINT)
    const raw = (parsed.value && typeof parsed.value === 'object') ? parsed.value : {}

    const response: ContextResponse & {
      diagnostics: {
        modelId: string
        searchMode: string
        parseRetry: boolean
        evidenceCount: number
        jsonResponseMode: boolean
      }
    } = {
      lastEarnings: (raw.lastEarnings && typeof raw.lastEarnings === 'object')
        ? {
            date: asString(raw.lastEarnings.date),
            result: raw.lastEarnings.result === 'beat' || raw.lastEarnings.result === 'miss' || raw.lastEarnings.result === 'inline'
              ? raw.lastEarnings.result
              : null,
            detail: asString(raw.lastEarnings.detail),
          }
        : null,
      nextEarnings: asString(raw.nextEarnings),
      news: Array.isArray(raw.news)
        ? raw.news
            .map((n: any) => {
              const headline = asString(n?.headline)
              if (!headline) return null
              return {
                headline,
                sentiment: n?.sentiment === 'positive' || n?.sentiment === 'negative' || n?.sentiment === 'neutral'
                  ? n.sentiment
                  : 'neutral',
              }
            })
            .filter(Boolean)
            .slice(0, 2) as { headline: string; sentiment: 'positive' | 'negative' | 'neutral' }[]
        : [],
      macroRisk: asString(raw.macroRisk),
      macroRiskEvidence: normalizeEvidenceList(raw.macroRiskEvidence),
      macroRiskInsufficientEvidenceReason: asString(raw.macroRiskInsufficientEvidenceReason),
      bankruptcyRisk: (raw.bankruptcyRisk && typeof raw.bankruptcyRisk === 'object')
        ? {
            level: asRiskLevel(raw.bankruptcyRisk.level),
            signals: Array.isArray(raw.bankruptcyRisk.signals)
              ? raw.bankruptcyRisk.signals.map((s: unknown) => asString(s)).filter(Boolean).slice(0, 3) as string[]
              : [],
            detail: asString(raw.bankruptcyRisk.detail),
            evidence: normalizeEvidenceList(raw.bankruptcyRisk.evidence),
            insufficientEvidenceReason: asString(raw.bankruptcyRisk.insufficientEvidenceReason),
          }
        : null,
      financialHealth: (raw.financialHealth && typeof raw.financialHealth === 'object')
        ? {
            status: asHealthStatus(raw.financialHealth.status),
            detail: asString(raw.financialHealth.detail),
            evidence: normalizeEvidenceList(raw.financialHealth.evidence),
            insufficientEvidenceReason: asString(raw.financialHealth.insufficientEvidenceReason),
          }
        : null,
      asOf: asString(raw.asOf) ?? nowIso,
      searchWindow: {
        from: asString(raw.searchWindow?.from) ?? from,
        to: asString(raw.searchWindow?.to) ?? today,
      },
      dataQuality: 'low',
      diagnostics: {
        modelId: search.meta.modelId,
        searchMode: search.meta.searchMode,
        parseRetry: parsed.repaired,
        evidenceCount: 0,
        jsonResponseMode: search.meta.jsonResponseMode,
      },
    }

    const evidenceCount = countEvidence(response)
    response.dataQuality = deriveDataQuality(asDataQuality(raw.dataQuality), evidenceCount)
    response.diagnostics.evidenceCount = evidenceCount

    return res.status(200).json(response)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
