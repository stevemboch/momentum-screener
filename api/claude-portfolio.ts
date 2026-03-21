import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiChat, parseJSON } from '../server/gemini'
import { requireAuth } from '../server/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  const { instruments } = req.body
  if (!Array.isArray(instruments) || instruments.length === 0)
    return res.status(400).json({ error: 'instruments array required' })

  const systemPrompt = `You are a quantitative analyst specialising in momentum 
strategies. You are analysing a portfolio that is DELIBERATELY momentum-focused —
momentum concentration is therefore NOT a problem and must NEVER be reported as 
a finding.

CONTEXT:
This tool is a momentum screener. The user selects instruments with the strongest
momentum and risk-adjusted scores. High momentum concentration is the intended 
outcome, not a weakness.

DECODING THE DEDUP KEY:
Each instrument has a machine-generated "dedupKey" encoding its economic exposure.
Decode it as follows:

  Equity ETF:    R:{Region}|SR:{Subregion}|F:{Factors}|S:{Sector}|[ESG]|[HEDGED]
  Bond ETF:      BOND|R:{Region}|BT:{BondType}|DUR:{Duration}|[ESG]|[HEDGED]
  Commodity ETC: COMMODITY:{Commodity}|[HEDGED]

Value "_" means: not set / unknown.

Examples:
  "R:US|SR:_|F:_|S:TECH"            → US Technology ETF
  "R:EUROPE|SR:_|F:DIVIDEND|S:_"    → European Dividend Factor ETF
  "R:WORLD|SR:_|F:_|S:_|ESG"        → MSCI World ESG
  "COMMODITY:GOLD"                   → Gold ETC
  "R:US|SR:_|F:_|S:_|HEDGED"        → US ETF currency-hedged (EUR/USD)

If "dedupKey" is null, use in this order:
  1. "xetraGroup" — often contains direct region/index info
     (e.g. "NORDAMERIKA", "DAX", "EMERGING MARKETS")
  2. "longName" — full ETF name for deriving region/sector
  3. "name" — short name as last resort

If all three are null or uninformative:
  ignore this instrument completely — do not mention it, do not speculate.

SPECULATION BAN:
  NEVER infer cluster risks from words like "Emerging", "Latin", "Basic" 
  in the name if you have fewer than 3 instruments with clear data.
  If >50% of instruments have no analysable exposure data:
  return severity "ok" with a single finding:
  "Insufficient exposure data for a full analysis — load instruments via 
   the Xetra universe for better results."

WHAT TO ANALYSE (only these criteria):

1. GEOGRAPHIC CONCENTRATION
   Are >60% of positions in a single region (e.g. only US)?
   Momentum rallies are often regional — a regime shift hits all at once.
   Only flag if truly extreme.

2. SECTOR CONCENTRATION
   Are >50% in a single sector (e.g. only Tech, only Defence)?
   Sector rotation can hit an entire momentum strategy simultaneously.
   Do not flag if sector is "_" (unknown).

3. CURRENCY RISK
   The "currency" field contains the trading currency (e.g. "USD", "EUR", "GBP").
   Only flag if >50% of positions have currency != "EUR" AND dedupKey 
   does not contain "HEDGED".
   Null currency does not count as foreign currency.

4. TRUE REDUNDANCY
   Are there two or more instruments with a near-identical dedupKey
   (same region + same sector + same factors)?
   This means duplicate exposure without diversification benefit.
   Name the specific instruments that are redundant.

5. SHARED MACRO FACTOR
   Do all or almost all positions depend on the same macro factor?
   Examples: all benefit from AI boom, all from defence spending,
   all from falling rates.
   Only flag if truly obvious — do not speculate.

RULES:
- Momentum focus is NEVER a finding
- Value/momentum imbalance is NEVER a finding for this tool
- If the portfolio is well diversified: severity "ok" with a positive 
  finding (e.g. "Good geographic spread across US, Europe and EM")
- Maximum 3 findings — only real problems, no theoretical risks
- Always name specific instrument names, never abstract
- No disclaimer, no introduction

Respond exclusively as valid JSON without Markdown backticks:
{ "severity": "ok" | "warning" | "critical", "findings": ["string"] }`

  try {
    const raw = await geminiChat(systemPrompt, JSON.stringify(instruments, null, 2))
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
