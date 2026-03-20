import type { VercelRequest, VercelResponse } from '@vercel/node'
import { geminiChat } from './_gemini'

const SYSTEM_PROMPT = `Du bist ein Filter-Generator fuer einen Xetra-Aktien-Screener.
Deine Aufgabe: Wandle einen Nutzerwunsch in eine JavaScript-Pfeilfunktion um.
Die Funktion nimmt ein "inst"-Objekt und gibt true/false zurueck.
Gib AUSSCHLIESSLICH die Pfeilfunktion zurueck, kein JSON, keine Erklaerung, keine Backticks.

VERFUEGBARE FELDER:

// Stammdaten
inst.type: 'ETF' | 'ETC' | 'Stock'
inst.isin: string
inst.displayName: string
inst.currency: string | null
inst.xetraGroup: string | null
  Moegliche Werte: 'DAX', 'MDAX', 'SDAX', 'DEUTSCHLAND', 'NORDAMERIKA',
  'FRANKREICH', 'GROSSBRITANNIEN', 'SKANDINAVIEN', 'SCHWEIZ LIECHTENSTEIN',
  'BELGIEN NIEDERLANDE LUXEMBURG', 'ITALIEN GRIECHENLAND', 'OESTERREICH', 'SPANIEN PORTUGAL'
inst.inPortfolio: boolean

// ETF-spezifisch
inst.aum: number | null     (in EUR, z.B. 1000000000 = 1 Mrd)
inst.ter: number | null     (in Prozent, z.B. 0.07 = 0.07%)

// Kurs & Performance
inst.r1m: number | null     (Return, z.B. 0.05 = +5%, -0.10 = -10%)
inst.r3m: number | null
inst.r6m: number | null
inst.vola: number | null    (annualisiert, z.B. 0.25 = 25%)
inst.rsi14: number | null   (0-100)
inst.levyRS: number | null  (>1.0 = ueber Halbjahres-Trend)

// Gleitende Durchschnitte
inst.ma50/ma100/ma200: number | null
inst.aboveMa10/aboveMa50/aboveMa100/aboveMa200: boolean | null

// Rankings (1 = bestes Instrument im Universum)
inst.momentumRank: number | undefined
inst.riskAdjustedRank: number | undefined
inst.combinedRank: number | undefined

// Scores (0-1, hoeher = besser)
inst.momentumScore: number | null
inst.riskAdjustedScore: number | null
inst.combinedScore: number | null
inst.pullbackScore: number | null
inst.breakoutScore: number | null   (0-5 Punkte)

// Fundamentals (Stocks)
inst.pe: number | null              (KGV)
inst.pb: number | null              (KBV)
inst.returnOnAssets: number | null  (z.B. 0.08 = 8%)
inst.ebitda: number | null
inst.enterpriseValue: number | null
inst.earningsYield: number | null
inst.analystRating: number | null   (1=Strong Buy, 5=Sell)
inst.analystOpinions: number | null
inst.marketCap: number | null       (in EUR)

// Drawdown (negativ, z.B. -0.45 = 45% unter Hoch)
inst.drawFromHigh: number | null    (vs. 52W-Hoch)
inst.drawFrom5YHigh: number | null
inst.drawFrom7YHigh: number | null

// TFA
inst.tfaPhase: 'none'|'monitoring'|'above_all_mas'|'watch'|'fetching'|'qualified'|'rejected'|'ko' | undefined
inst.tfaScore: number | null
inst.tfaScenario: '52w'|'5y'|'7y' | null
inst.tfaEScore: number | null
inst.tfaKO: boolean | undefined

// Datenstatus
inst.priceFetched: boolean | undefined
inst.analystFetched: boolean | undefined
inst.fundamentalsFetched: boolean | undefined

REGELN:
- Nutze ?? fuer nullable Felder: (inst.rsi14 ?? 100) < 40
- xetraGroup: inst.xetraGroup === 'DAX' oder Array.includes()
- Fuer "Deutschland": ['DAX','MDAX','SDAX','DEUTSCHLAND'].includes(inst.xetraGroup ?? '')
- AUM in Mrd: inst.aum > 1_000_000_000
- TER direkt in %: inst.ter < 0.2
- Returns: 0.10 = +10%
- Unbekannte Felder: konservativ true zurueckgeben

BEISPIELE:
Wunsch: "nur profitable Stocks mit RSI unter 50"
Output: (inst) => inst.type === 'Stock' && (inst.returnOnAssets ?? -1) > 0 && (inst.rsi14 ?? 100) < 50

Wunsch: "ETFs mit TER unter 0.2% und AUM ueber 500 Mio"
Output: (inst) => (inst.type === 'ETF' || inst.type === 'ETC') && (inst.ter ?? 99) < 0.2 && (inst.aum ?? 0) > 500_000_000

Wunsch: "deutsche Aktien im Aufwaertstrend"
Output: (inst) => inst.type === 'Stock' && ['DAX','MDAX','SDAX','DEUTSCHLAND'].includes(inst.xetraGroup ?? '') && inst.aboveMa200 === true

Wunsch: "TFA-Kandidaten noch nicht analysiert"
Output: (inst) => inst.type === 'Stock' && (inst.tfaPhase === 'monitoring' || inst.tfaPhase === 'watch') && !inst.analystFetched

Wunsch: "Top-50 Momentum nicht im Portfolio"
Output: (inst) => (inst.momentumRank ?? 9999) <= 50 && !inst.inPortfolio`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { query } = req.body
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query required' })
  }

  try {
    const raw = await geminiChat(SYSTEM_PROMPT, `Nutzerwunsch: "${query.trim()}"`)

    const fn = raw
      .replace(/^```(?:javascript|js|typescript|ts)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    if (!fn.startsWith('(inst)') && !fn.startsWith('inst =>') && !fn.startsWith('inst=>')) {
      return res.status(422).json({ error: 'Ungueltige Funktion generiert', raw: fn })
    }

    try {
      new Function('inst', `"use strict"; return (${fn})(inst)`)
    } catch (syntaxErr: any) {
      return res.status(422).json({ error: 'Syntax-Fehler', details: syntaxErr.message, raw: fn })
    }

    return res.status(200).json({ fn, query: query.trim() })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
