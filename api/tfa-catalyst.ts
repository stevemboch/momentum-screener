import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiSearchChatWithMeta, parseJSONWithRepair } from '../server/gemini'
import { requireAuth } from '../server/auth'

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
  not_found: 0.0,
}

type Confidence = 'high' | 'medium' | 'low' | 'not_found'
type SourceType = 'primary' | 'regulatory' | 'major_media' | 'secondary'
type DataQuality = 'high' | 'medium' | 'low'

interface EvidenceItem {
  sourceName: string | null
  sourceType: SourceType
  url: string | null
  publishedAt: string | null
  confidence: 'high' | 'medium' | 'low'
  confidenceReason: string | null
}

interface SignalBase {
  confidence: Confidence
  source: string | null
  confidenceReason: string | null
  evidence: EvidenceItem[]
}

interface NumericSignalValue extends SignalBase {
  value: number
}

interface BooleanSignalValue extends SignalBase {
  value: boolean
}

type SignalValue = NumericSignalValue | BooleanSignalValue

interface CatalystSignals {
  earnings_beat_recent: NumericSignalValue | null
  earnings_beat_prior: NumericSignalValue | null
  guidance_raised: NumericSignalValue | null
  analyst_upgrade: NumericSignalValue | null
  insider_buying: NumericSignalValue | null
  restructuring: NumericSignalValue | null
  ko_risk: BooleanSignalValue | null
}

const CATALYST_SCHEMA_HINT = `{
  "signals": {
    "earnings_beat_recent": { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "earnings_beat_prior":  { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "guidance_raised":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "analyst_upgrade":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "insider_buying":       { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "restructuring":        { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] },
    "ko_risk":              { "value": true|false, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [EvidenceItem] }
  },
  "summary": "string|null",
  "asOf": "ISO-8601",
  "searchWindow": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "dataQuality": "high|medium|low"
}`

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const cleaned = v.trim()
  return cleaned.length > 0 ? cleaned : null
}

function asConfidence(v: unknown): Confidence {
  if (v === 'high' || v === 'medium' || v === 'low' || v === 'not_found') return v
  return 'not_found'
}

function asSourceType(v: unknown): SourceType {
  if (v === 'primary' || v === 'regulatory' || v === 'major_media' || v === 'secondary') return v
  return 'secondary'
}

function asDataQuality(v: unknown): DataQuality | null {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return null
}

function normalizeEvidenceList(v: unknown, fallbackConfidence: Confidence): EvidenceItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return null
      const src = item as any
      return {
        sourceName: asString(src.sourceName),
        sourceType: asSourceType(src.sourceType),
        url: asString(src.url),
        publishedAt: asString(src.publishedAt),
        confidence: asConfidence(src.confidence) === 'not_found' ? (fallbackConfidence === 'not_found' ? 'low' : fallbackConfidence) : (asConfidence(src.confidence) as 'high' | 'medium' | 'low'),
        confidenceReason: asString(src.confidenceReason),
      }
    })
    .filter(Boolean)
    .slice(0, 3) as EvidenceItem[]
}

function normalizeNumericSignal(v: unknown): NumericSignalValue | null {
  if (!v || typeof v !== 'object') return null
  const src = v as any
  const confidence = asConfidence(src.confidence)
  const rawVal = Number(src.value)
  const value = rawVal === 0 || rawVal === 0.5 || rawVal === 1 ? rawVal : 0
  const evidence = normalizeEvidenceList(src.evidence, confidence)
  const source = asString(src.source) ?? (evidence[0]?.sourceName ?? null)
  return {
    value,
    confidence,
    source,
    confidenceReason: asString(src.confidenceReason),
    evidence,
  }
}

function normalizeBooleanSignal(v: unknown): BooleanSignalValue | null {
  if (!v || typeof v !== 'object') return null
  const src = v as any
  const confidence = asConfidence(src.confidence)
  const value = src.value === true
  const evidence = normalizeEvidenceList(src.evidence, confidence)
  const source = asString(src.source) ?? (evidence[0]?.sourceName ?? null)
  return {
    value,
    confidence,
    source,
    confidenceReason: asString(src.confidenceReason),
    evidence,
  }
}

function countEvidence(signals: CatalystSignals): number {
  return Object.values(signals).reduce((acc, s) => acc + (s?.evidence.length ?? 0), 0)
}

function deriveDataQuality(proposed: DataQuality | null, evidenceCount: number, supportedSignals: number): DataQuality {
  if (proposed) return proposed
  if (evidenceCount === 0) return 'low'
  const coverage = evidenceCount / Math.max(supportedSignals, 1)
  if (coverage >= 1.2) return 'high'
  if (coverage >= 0.6) return 'medium'
  return 'low'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const { ticker, name, drawFromHigh, drawFrom5YHigh, drawFrom7YHigh, scenario } = req.body
  if (!ticker || !name) return res.status(400).json({ error: 'ticker and name required' })

  const today = new Date().toISOString().split('T')[0]
  const d180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const drawPct =
    scenario === '7y' && drawFrom7YHigh != null ? Math.abs(drawFrom7YHigh * 100).toFixed(0)
    : scenario === '5y' && drawFrom5YHigh != null ? Math.abs(drawFrom5YHigh * 100).toFixed(0)
    : drawFromHigh != null ? Math.abs(drawFromHigh * 100).toFixed(0)
    : '?'

  const scenarioContext =
    scenario === '7y'
      ? `7-year structural deep-value candidate (${drawPct}% below 7Y high). Focus: new management, business model transformation, industry cycle turn, debt restructuring.`
      : scenario === '5y'
        ? `Multi-year turnaround candidate (${drawPct}% below 5Y high). Focus: cost restructuring, sector recovery, regulatory tailwinds, improved capital allocation.`
        : `Short-term reversal candidate (${drawPct}% below 52W high). Focus: earnings recovery, sector rotation, resolution of negative event.`

  const systemPrompt = `You are a quantitative turnaround analyst for European stocks.
Search for SPECIFIC VERIFIABLE FACTS only. Do NOT estimate or infer.
Search in both English AND German language sources.
Follow this strict protocol:
1) Confirm the correct entity (ticker+name) before extracting facts.
2) Use source hierarchy: primary/regulatory > major_media > secondary.
3) No hard claim without evidence. If evidence is weak, use lower confidence or not_found.
4) Use absolute dates and stay within the provided search windows.
5) If sources conflict, prefer "mixed/uncertain" interpretation over forced certainty.
For German stocks also search: "[company] Quartalsbericht", "[company] Insiderkauf BaFin",
"[company] Prognoseerhöhung", "[company] Analystenupgrade".
Answer exclusively as valid JSON, no markdown.`

  const userMessage = `
Stock: ${name} (Ticker: ${ticker})
Context: ${scenarioContext}
Analysis date: ${today}

Search for VERIFIABLE FACTS for each signal. Mark confidence:
- "high": found in primary source (earnings release, regulatory filing, official news)
- "medium": found in secondary source (analyst note, financial news summary)
- "low": found only as indirect reference
- "not_found": could not find evidence (this is NEUTRAL, not negative)

Search period: ${d180} to ${today} for earnings/guidance/restructuring
Search period: ${d90} to ${today} for upgrades and insider buying

SIGNAL 1 — earnings_beat_recent:
Search: "${ticker} earnings beat consensus" OR "${name} Quartalsergebnis übertroffen ${today.slice(0,4)}"
Did the MOST RECENT quarterly earnings beat analyst EPS consensus?

SIGNAL 2 — earnings_beat_prior:
Did the PRIOR quarter (one before the most recent) also beat EPS consensus?
Two consecutive beats = strong trend confirmation.

SIGNAL 3 — guidance_raised:
Search: "${name} raises guidance" OR "${name} Prognoseerhöhung" OR "${ticker} raises outlook"
Did the company raise full-year revenue or earnings guidance since ${d180}?

SIGNAL 4 — analyst_upgrade:
Search: "${name} analyst upgrade" OR "${name} Analystenupgrade" OR "${ticker} price target raised"
Has any analyst upgraded the stock or raised price target since ${d90}?

SIGNAL 5 — insider_buying:
Search: "${name} insider purchase" OR "${name} Insiderkauf BaFin" OR "${ticker} director buying"
Have company insiders (executives/board) purchased shares since ${d90}?

SIGNAL 6 — restructuring:
Search: "${name} restructuring" OR "${name} Restrukturierung" OR "${name} new CEO" OR "${name} strategic review"
Is there a credible restructuring, new CEO, or strategic pivot since ${d180}?

SIGNAL 7 — ko_risk:
Search: "${name} insolvency" OR "${name} Insolvenz" OR "${name} going concern" OR "${name} covenant breach"
Any signs of insolvency risk, going concern warning, or massive insider selling?

Return ONLY this JSON:
{
  "signals": {
    "earnings_beat_recent": { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "earnings_beat_prior":  { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "guidance_raised":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "analyst_upgrade":      { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "insider_buying":       { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "restructuring":        { "value": 0|0.5|1, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] },
    "ko_risk":              { "value": true|false, "confidence": "high|medium|low|not_found", "source": "string|null", "confidenceReason": "string|null", "evidence": [{ "sourceName": "string|null", "sourceType": "primary|regulatory|major_media|secondary", "url": "string|null", "publishedAt": "string|null", "confidence": "high|medium|low", "confidenceReason": "string|null" }] }
  },
  "summary": "2-3 sentences factual summary of key findings",
  "asOf": "${new Date().toISOString()}",
  "searchWindow": { "from": "${d180}", "to": "${today}" },
  "dataQuality": "high|medium|low"
}`

  try {
    const search = await geminiSearchChatWithMeta(systemPrompt, userMessage)
    const parsed = await parseJSONWithRepair<any>(search.text, CATALYST_SCHEMA_HINT)
    const result = parsed.value && typeof parsed.value === 'object' ? parsed.value : {}
    const rawSignals = (result.signals && typeof result.signals === 'object') ? result.signals : {}
    const s: CatalystSignals = {
      earnings_beat_recent: normalizeNumericSignal(rawSignals.earnings_beat_recent),
      earnings_beat_prior: normalizeNumericSignal(rawSignals.earnings_beat_prior),
      guidance_raised: normalizeNumericSignal(rawSignals.guidance_raised),
      analyst_upgrade: normalizeNumericSignal(rawSignals.analyst_upgrade),
      insider_buying: normalizeNumericSignal(rawSignals.insider_buying),
      restructuring: normalizeNumericSignal(rawSignals.restructuring),
      ko_risk: normalizeBooleanSignal(rawSignals.ko_risk),
    }

    const koRisk = s.ko_risk?.value === true && ['high', 'medium'].includes(s.ko_risk?.confidence ?? '')

    const activeSignals = [
      'earnings_beat_recent',
      'earnings_beat_prior',
      'guidance_raised',
      'analyst_upgrade',
      'insider_buying',
      'restructuring',
    ] as const

    let sum = 0
    let count = 0
    for (const key of activeSignals) {
      const sig = s[key]
      if (!sig || sig.confidence === 'not_found') continue
      const conf = CONFIDENCE_WEIGHTS[sig.confidence] ?? 0
      sum += (sig.value ?? 0) * conf
      count++
    }

    const eScore = koRisk ? 0 : (count === 0 ? null : sum / count)
    const evidenceCount = countEvidence(s)
    const dataQuality = deriveDataQuality(asDataQuality(result.dataQuality), evidenceCount, activeSignals.length + 1)
    const nowIso = new Date().toISOString()

    return res.status(200).json({
      signals: s,
      eScore,
      koRisk,
      summary: asString(result.summary),
      asOf: asString(result.asOf) ?? nowIso,
      searchWindow: {
        from: asString(result.searchWindow?.from) ?? d180,
        to: asString(result.searchWindow?.to) ?? today,
      },
      dataQuality,
      diagnostics: {
        modelId: search.meta.modelId,
        searchMode: search.meta.searchMode,
        parseRetry: parsed.repaired,
        evidenceCount,
        jsonResponseMode: search.meta.jsonResponseMode,
      },
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
