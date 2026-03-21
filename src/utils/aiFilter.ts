import type { AiFilterPlan, AiFilterRule, Instrument } from '../types'

type Primitive = string | number | boolean | null

const MAX_RULES = 20
const MAX_IN_VALUES = 30

const ALLOWED_FIELDS = new Set<string>([
  'type', 'isin', 'displayName', 'currency', 'xetraGroup', 'inPortfolio',
  'aum', 'ter',
  'r1m', 'r3m', 'r6m', 'vola', 'rsi14', 'levyRS',
  'ma50', 'ma100', 'ma200', 'aboveMa10', 'aboveMa50', 'aboveMa100', 'aboveMa200',
  'momentumRank', 'riskAdjustedRank', 'combinedRank',
  'momentumScore', 'riskAdjustedScore', 'combinedScore', 'pullbackScore', 'breakoutScore',
  'pe', 'pb', 'returnOnAssets', 'ebitda', 'enterpriseValue', 'earningsYield',
  'analystRating', 'analystOpinions', 'marketCap',
  'drawFromHigh', 'drawFrom5YHigh', 'drawFrom7YHigh',
  'tfaPhase', 'tfaScore', 'tfaScenario', 'tfaEScore', 'tfaKO',
  'priceFetched', 'analystFetched', 'fundamentalsFetched',
])

function isPrimitive(value: unknown): value is Primitive {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isOperator(value: unknown): value is AiFilterRule['operator'] {
  return value === 'eq' || value === 'neq' || value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte' || value === 'in'
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

export function isAiFilterPlan(value: unknown): value is AiFilterPlan {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) return false
  if (obj.match !== 'all' && obj.match !== 'any') return false
  if (!Array.isArray(obj.rules) || obj.rules.length > MAX_RULES) return false
  return obj.rules.every((r) => isRule(r))
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function evaluateRule(inst: Instrument, rule: AiFilterRule): boolean {
  const raw = (inst as unknown as Record<string, unknown>)[rule.field]
  const left = raw ?? rule.fallback
  if (left === undefined) return true

  if (rule.operator === 'in') {
    if (!Array.isArray(rule.value)) return true
    return rule.value.some((v) => Object.is(v, left))
  }

  if (rule.operator === 'eq') return Object.is(left, rule.value)
  if (rule.operator === 'neq') return !Object.is(left, rule.value)

  const lNum = toNumberOrNull(left)
  const rNum = toNumberOrNull(rule.value)
  if (lNum == null || rNum == null) return true
  if (rule.operator === 'gt') return lNum > rNum
  if (rule.operator === 'gte') return lNum >= rNum
  if (rule.operator === 'lt') return lNum < rNum
  if (rule.operator === 'lte') return lNum <= rNum
  return true
}

export function applyAiFilterPlan(instruments: Instrument[], plan: AiFilterPlan | null): Instrument[] {
  if (!plan || plan.rules.length === 0) return instruments
  return instruments.filter((inst) => {
    const results = plan.rules.map((rule) => {
      try {
        return evaluateRule(inst, rule)
      } catch {
        return true
      }
    })
    return plan.match === 'all' ? results.every(Boolean) : results.some(Boolean)
  })
}
