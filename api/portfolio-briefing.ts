import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChatWithMeta, parseJSONWithRepair } from '../server/gemini'
import { requireAuth } from '../server/auth'

type Priority = 'high' | 'medium' | 'low'
type Sentiment = 'positive' | 'negative' | 'neutral'
type DataQuality = 'high' | 'medium' | 'low'
type SourceType = 'primary' | 'regulatory' | 'major_media' | 'secondary'
type Confidence = 'high' | 'medium' | 'low'

interface EvidenceItem {
  sourceName: string | null
  sourceType: SourceType
  url: string | null
  publishedAt: string | null
  confidence: Confidence
  confidenceReason: string | null
}

interface BriefingFinding {
  priority: Priority
  instruments: string[]
  headline: string
  detail: string
  sentiment: Sentiment
  evidence: EvidenceItem[]
  insufficientEvidenceReason: string | null
}

interface BriefingResponse {
  findings: BriefingFinding[]
  macroContext: string
  macroContextEvidence: EvidenceItem[]
  macroContextInsufficientEvidenceReason: string | null
  asOf: string
  searchWindow: { from: string; to: string }
  dataQuality: DataQuality
  generatedAt: string
}

const BRIEFING_SCHEMA_HINT = `{
  "findings": [
    {
      "priority": "high|medium|low",
      "instruments": ["string"],
      "headline": "string",
      "detail": "string",
      "sentiment": "positive|negative|neutral",
      "evidence": [
        {
          "sourceName": "string|null",
          "sourceType": "primary|regulatory|major_media|secondary",
          "url": "string|null",
          "publishedAt": "YYYY-MM-DD|null",
          "confidence": "high|medium|low",
          "confidenceReason": "string|null"
        }
      ],
      "insufficientEvidenceReason": "string|null"
    }
  ],
  "macroContext": "string",
  "macroContextEvidence": [{
    "sourceName": "string|null",
    "sourceType": "primary|regulatory|major_media|secondary",
    "url": "string|null",
    "publishedAt": "YYYY-MM-DD|null",
    "confidence": "high|medium|low",
    "confidenceReason": "string|null"
  }],
  "macroContextInsufficientEvidenceReason": "string|null",
  "asOf": "ISO-8601",
  "searchWindow": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "dataQuality": "high|medium|low",
  "generatedAt": "ISO-8601"
}`

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const cleaned = v.trim()
  return cleaned.length > 0 ? cleaned : null
}

function asPriority(v: unknown): Priority {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function asSentiment(v: unknown): Sentiment {
  if (v === 'positive' || v === 'negative' || v === 'neutral') return v
  return 'neutral'
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

function normalizeEvidenceList(v: unknown, max = 3): EvidenceItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map(normalizeEvidence)
    .filter(Boolean)
    .slice(0, max) as EvidenceItem[]
}

function normalizeFinding(v: unknown): BriefingFinding | null {
  if (!v || typeof v !== 'object') return null
  const src = v as any
  const headline = asString(src.headline)
  const detail = asString(src.detail)
  if (!headline || !detail) return null
  return {
    priority: asPriority(src.priority),
    instruments: Array.isArray(src.instruments)
      ? src.instruments.map((i: unknown) => asString(i)).filter(Boolean).slice(0, 6) as string[]
      : [],
    headline,
    detail,
    sentiment: asSentiment(src.sentiment),
    evidence: normalizeEvidenceList(src.evidence, 3),
    insufficientEvidenceReason: asString(src.insufficientEvidenceReason),
  }
}

function countEvidence(findings: BriefingFinding[], macroEvidence: EvidenceItem[]): number {
  return findings.reduce((acc, f) => acc + f.evidence.length, macroEvidence.length)
}

function deriveDataQuality(proposed: DataQuality | null, findings: BriefingFinding[], evidenceCount: number): DataQuality {
  if (proposed) return proposed
  if (findings.length === 0 || evidenceCount === 0) return 'low'
  const coverage = evidenceCount / findings.length
  if (coverage >= 1.4) return 'high'
  if (coverage >= 0.8) return 'medium'
  return 'low'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  const { instruments } = req.body
  if (!Array.isArray(instruments) || instruments.length === 0)
    return res.status(400).json({ error: 'instruments array required' })

  const compactInstruments = instruments.slice(0, 40).map((inst: any) => ({
    name: asString(inst?.name),
    type: asString(inst?.type),
    currency: asString(inst?.currency),
    momentumRank: typeof inst?.momentumRank === 'number' ? inst.momentumRank : null,
    r3m: typeof inst?.r3m === 'number' ? inst.r3m : null,
    r6m: typeof inst?.r6m === 'number' ? inst.r6m : null,
  }))
  const instrumentsJson = JSON.stringify(compactInstruments)

  const nowIso = new Date().toISOString()
  const today = nowIso.split('T')[0]
  const from = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const systemPrompt = `You are an independent financial analyst focused on 
momentum strategies. You receive a portfolio and must research current market 
developments relevant to these specific positions using web search.

Respond exclusively in English. Be precise and factual.
No disclaimers, no introductions, no filler phrases.
Follow this strict protocol:
1) Entity disambiguation: use exact instrument names/tickers from input only.
2) Time discipline: use absolute dates and stay inside the requested search window.
3) Source hierarchy: primary/regulatory > major_media > secondary.
4) Evidence-first claims: no hard claim without evidence.
5) If evidence is thin or conflicting, explicitly return insufficientEvidenceReason.
6) When sources conflict, report mixed evidence instead of forcing certainty.
Respond exclusively as valid JSON without Markdown backticks.`

  const userMessage =
`Portfolio positions:
${instrumentsJson}

Analysis date: ${today}
Search window: ${from} to ${today}

Search for recent developments directly relevant to these 
specific positions. Focus on:
1. News that could threaten or confirm the current momentum of any position
2. Macro events affecting multiple positions simultaneously
   (e.g. interest rate moves, currency shifts, sector rotation signals)
3. Significant analyst rating changes or earnings surprises
4. Any position-specific risks that have emerged recently

Prioritise findings by relevance and urgency.
Skip generic market commentary.
Name specific instruments from the portfolio in each finding.
Keep findings concrete and short, with date context and portfolio implication.

Return as JSON:
{
  "findings": [
    {
      "priority": "high" | "medium" | "low",
      "instruments": ["name1", "name2"],
      "headline": "One-line summary",
      "detail": "2-3 sentences of context and implication for the position",
      "sentiment": "positive" | "negative" | "neutral",
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
    }
  ],
  "macroContext": "1-2 sentences on the broader market environment relevant to this portfolio as a whole",
  "macroContextEvidence": [
    {
      "sourceName": string | null,
      "sourceType": "primary" | "regulatory" | "major_media" | "secondary",
      "url": string | null,
      "publishedAt": string | null,
      "confidence": "high" | "medium" | "low",
      "confidenceReason": string | null
    }
  ],
  "macroContextInsufficientEvidenceReason": string | null,
  "asOf": "${nowIso}",
  "searchWindow": { "from": "${from}", "to": "${today}" },
  "dataQuality": "high" | "medium" | "low",
  "generatedAt": "${nowIso}"
}

Maximum 5 findings. Sort by priority (high first). Include 1-3 evidence items per finding when available.`

  try {
    const search = await geminiSearchChatWithMeta(systemPrompt, userMessage)
    const parsed = await parseJSONWithRepair<any>(search.text, BRIEFING_SCHEMA_HINT)
    const raw = (parsed.value && typeof parsed.value === 'object') ? parsed.value : {}

    const findings = Array.isArray(raw.findings)
      ? raw.findings.map(normalizeFinding).filter(Boolean).slice(0, 5) as BriefingFinding[]
      : []
    const macroContext = asString(raw.macroContext) ?? ''
    const macroContextEvidence = normalizeEvidenceList(raw.macroContextEvidence, 3)
    const evidenceCount = countEvidence(findings, macroContextEvidence)
    const dataQuality = deriveDataQuality(asDataQuality(raw.dataQuality), findings, evidenceCount)

    const response: BriefingResponse & {
      diagnostics: {
        modelId: string
        searchMode: string
        parseRetry: boolean
        evidenceCount: number
        jsonResponseMode: boolean
      }
    } = {
      findings,
      macroContext,
      macroContextEvidence,
      macroContextInsufficientEvidenceReason: asString(raw.macroContextInsufficientEvidenceReason),
      asOf: asString(raw.asOf) ?? nowIso,
      searchWindow: {
        from: asString(raw.searchWindow?.from) ?? from,
        to: asString(raw.searchWindow?.to) ?? today,
      },
      dataQuality,
      generatedAt: asString(raw.generatedAt) ?? nowIso,
      diagnostics: {
        modelId: search.meta.modelId,
        searchMode: search.meta.searchMode,
        parseRetry: parsed.repaired,
        evidenceCount,
        jsonResponseMode: search.meta.jsonResponseMode,
      },
    }

    return res.status(200).json(response)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
