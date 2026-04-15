import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiChat, parseJSON } from '../server/gemini'
import { requireAuth } from '../server/auth'

type Primitive = string | number | boolean | null
type Operator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'

interface AiFilterRule {
  field: string
  operator: Operator
  value: Primitive | Primitive[]
  fallback?: Primitive
}

interface AiFilterPlan {
  version: 1
  match: 'all' | 'any'
  rules: AiFilterRule[]
}

const MAX_RULES = 20
const MAX_IN_VALUES = 30

const ALLOWED_FIELDS = new Set([
  'type', 'isin', 'displayName', 'name', 'xetraName', 'longName', 'yahooLongName',
  'currency', 'xetraGroup', 'group', 'inPortfolio',
  'sector', 'sektor', 'industry',
  'aum', 'ter',
  'upside', 'downside', 'upsidePct', 'downsidePct',
  'r1m', 'r3m', 'r6m', 'vola', 'rsi14', 'levyRS',
  'ma50', 'ma100', 'ma200', 'aboveMa10', 'aboveMa50', 'aboveMa100', 'aboveMa200',
  'momentumRank', 'riskAdjustedRank', 'combinedRank',
  'momentumScore', 'riskAdjustedScore', 'combinedScore', 'pullbackScore', 'breakoutScore',
  'pe', 'pb', 'returnOnAssets', 'ebitda', 'enterpriseValue', 'earningsYield',
  'analystRating', 'analystRatingKey', 'analystOpinions', 'marketCap',
  'targetPrice', 'targetPriceAdj', 'analystCurrentPrice', 'analystTarget',
  'drawFromHigh', 'drawFrom5YHigh', 'drawFrom7YHigh',
  'tfaPhase', 'tfaScore', 'tfaScenario', 'tfaEScore', 'tfaKO',
  'priceFetched', 'analystFetched', 'fundamentalsFetched',
])

const SYSTEM_PROMPT = `Du bist ein Filter-Generator fuer einen Xetra-Aktien-Screener.
Wandle einen Nutzerwunsch in ein strikt valides JSON-Objekt mit diesem Schema:
{
  "version": 1,
  "match": "all" | "any",
  "rules": [
    {
      "field": string,
      "operator": "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains",
      "value": string | number | boolean | null | Array<string|number|boolean|null>,
      "fallback": string | number | boolean | null (optional)
    }
  ]
}

WICHTIG:
- Gib NUR JSON zurueck. Keine Erklaerung, keine Markdown-Backticks.
- Nur Felder aus dieser Liste: ${Array.from(ALLOWED_FIELDS).join(', ')}.
- Feld-Mapping: Group -> group (oder xetraGroup), Sector/Sektor -> sector (oder sektor), Industry -> industry.
- Name/Titel -> name (nutze bei Namen bevorzugt "contains" fuer Teilstring-Matches).
- Analyst target / Upside -> analystTarget (oder upside), Downside -> downside.
- Analyst rating -> analystRating (numerisch) oder analystRatingKey (z.B. buy/hold/sell).
- Fuer analystTarget/upside/downside gelten Prozent-Ratios zum aktuellen Preis als Dezimalzahl (0.2 = +20%, -0.1 = -10%).
- "in" nutzt ein nicht-leeres Array in "value".
- max. 12 Regeln.
- Falls etwas unklar ist: konservativ bleiben (wenige Regeln, keine riskanten Annahmen).

Beispiele:
Nutzerwunsch: "nur profitable Stocks mit RSI unter 50"
{
  "version": 1,
  "match": "all",
  "rules": [
    { "field": "type", "operator": "eq", "value": "Stock" },
    { "field": "returnOnAssets", "operator": "gt", "value": 0, "fallback": -1 },
    { "field": "rsi14", "operator": "lt", "value": 50, "fallback": 100 }
  ]
}

Nutzerwunsch: "Top-50 Momentum nicht im Portfolio"
{
  "version": 1,
  "match": "all",
  "rules": [
    { "field": "momentumRank", "operator": "lte", "value": 50, "fallback": 9999 },
    { "field": "inPortfolio", "operator": "eq", "value": false, "fallback": false }
  ]
}`

function isPrimitive(value: unknown): value is Primitive {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isOperator(value: unknown): value is Operator {
  return value === 'eq' || value === 'neq' || value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte' || value === 'in' || value === 'contains'
}

function isRule(value: unknown): value is AiFilterRule {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.field !== 'string' || !ALLOWED_FIELDS.has(obj.field)) return false
  if (!isOperator(obj.operator)) return false

  if (obj.operator === 'in') {
    if (!Array.isArray(obj.value) || obj.value.length === 0 || obj.value.length > MAX_IN_VALUES) return false
    if (!obj.value.every((v) => isPrimitive(v))) return false
  } else if (!isPrimitive(obj.value)) {
    return false
  }

  if (obj.fallback !== undefined && !isPrimitive(obj.fallback)) return false
  return true
}

function isAiFilterPlan(value: unknown): value is AiFilterPlan {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) return false
  if (obj.match !== 'all' && obj.match !== 'any') return false
  if (!Array.isArray(obj.rules) || obj.rules.length > MAX_RULES) return false
  return obj.rules.every((r) => isRule(r))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const { query } = req.body
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query required' })
  }

  try {
    const raw = await geminiChat(SYSTEM_PROMPT, `Nutzerwunsch: "${query.trim()}"`)
    let plan: unknown
    try {
      plan = parseJSON<unknown>(raw)
    } catch {
      return res.status(422).json({ error: 'Ungueltiges JSON generiert' })
    }
    if (!isAiFilterPlan(plan)) {
      return res.status(422).json({ error: 'Ungueltiges Filter-JSON generiert' })
    }
    return res.status(200).json({ plan, query: query.trim() })
  } catch (err: any) {
    const message = err?.message || 'AI request failed'
    const isConfigError =
      message.includes('No AI provider configured')
      || message.includes('Missing GOOGLE_AI_API_KEY')
      || message.includes('OpenRouter fallback unavailable')
    return res.status(isConfigError ? 503 : 500).json({ error: message })
  }
}
