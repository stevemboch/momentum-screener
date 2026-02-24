import type { XetraRow, Instrument } from '../types'

// ─── Xetra CSV Parser ─────────────────────────────────────────────────────────

const KEEP_COLUMNS = [
  'Product Status', 'Instrument Status', 'Instrument', 'ISIN', 'WKN',
  'Mnemonic', 'Instrument Type', 'Product Assignment Group Description',
  'Currency', 'First Trading Date',
]

export function parseXetraCSV(csvText: string): XetraRow[] {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Skip first 2 metadata rows, row 3 (index 2) is the header
  if (lines.length < 4) return []

  const headerLine = lines[2]
  const headers = headerLine.split(';').map((h) => h.trim().replace(/"/g, ''))

  const colIdx = (name: string) => headers.findIndex((h) => h === name)
  const isinIdx = colIdx('ISIN')
  const instIdx = colIdx('Instrument')
  const wknIdx = colIdx('WKN')
  const mnemonicIdx = colIdx('Mnemonic')
  const typeIdx = colIdx('Instrument Type')
  const groupIdx = colIdx('Product Assignment Group Description')
  const currencyIdx = colIdx('Currency')
  const dateIdx = colIdx('First Trading Date')

  if (isinIdx < 0 || typeIdx < 0) return []

  const results: XetraRow[] = []
  const CHUNK = 300

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cells = line.split(';').map((c) => c.trim().replace(/"/g, ''))

    const instrumentType = cells[typeIdx] || ''
    const currency = cells[currencyIdx] || ''

    // Keep only ETF/ETC/CS, EUR/USD
    if (!['ETF', 'ETC', 'CS'].includes(instrumentType)) continue
    if (!['EUR', 'USD'].includes(currency)) continue

    results.push({
      instrument: cells[instIdx] || '',
      isin: cells[isinIdx] || '',
      wkn: cells[wknIdx] || '',
      mnemonic: cells[mnemonicIdx] || '',
      instrumentType,
      group: cells[groupIdx] || '',
      currency,
      firstTradingDate: cells[dateIdx] || '',
    })
  }

  return results
}

export function xetraRowToInstrument(row: XetraRow): Instrument {
  const mnemonic = row.mnemonic || ''
  const yahooTicker = mnemonic ? `${mnemonic}.DE` : ''

  let type: Instrument['type'] = 'Unknown'
  if (row.instrumentType === 'ETF') type = 'ETF'
  else if (row.instrumentType === 'ETC') type = 'ETC'
  else if (row.instrumentType === 'CS') type = 'Stock'

  return {
    isin: row.isin,
    wkn: row.wkn || undefined,
    mnemonic: mnemonic || undefined,
    yahooTicker,
    type,
    source: 'xetra',
    currency: row.currency,
    firstTradingDate: row.firstTradingDate || undefined,
    xetraGroup: row.group,
    xetraName: row.instrument,
    displayName: row.instrument || row.isin,
  }
}

// ─── Manual Input Parser ──────────────────────────────────────────────────────

const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{10}$/i
const WKN_REGEX = /^[A-Z0-9]{6}$/i
const SKIP_WORDS = new Set(['isin', 'wkn', 'ticker', 'symbol', 'mnemonic', 'name', 'cusip', 'sedol'])

export type IdentifierType = 'ISIN' | 'WKN' | 'Ticker'

export interface ParsedIdentifier {
  raw: string
  normalized: string
  type: IdentifierType
}

function normalizeTickerSuffix(raw: string): string {
  // Strip exchange suffixes for lookup purposes
  return raw.replace(/\.(DE|F|XETRA|ETR|BE|MU|HM|DU|SG|HA|BM)$/i, '').toUpperCase()
}

export function detectIdentifierType(token: string): IdentifierType {
  const upper = token.toUpperCase()
  if (ISIN_REGEX.test(upper)) return 'ISIN'
  // WKN: exactly 6 alphanumeric, no dot
  if (WKN_REGEX.test(upper) && !upper.includes('.')) return 'WKN'
  return 'Ticker'
}

export function parseManualInput(input: string): ParsedIdentifier[] {
  // Split on any delimiter
  const tokens = input
    .split(/[\n,;\t\s]+/)
    .map((t) => t.trim().replace(/"/g, ''))
    .filter((t) => t.length > 0)
    .filter((t) => !SKIP_WORDS.has(t.toLowerCase()))

  const seen = new Set<string>()
  const results: ParsedIdentifier[] = []

  for (const token of tokens) {
    const type = detectIdentifierType(token)
    const normalized =
      type === 'Ticker' ? normalizeTickerSuffix(token) : token.toUpperCase()

    if (!seen.has(normalized)) {
      seen.add(normalized)
      results.push({ raw: token, normalized, type })
    }
  }

  return results
}

export function parseCSVFile(content: string): ParsedIdentifier[] {
  // Auto-detect delimiter
  const firstLine = content.split('\n')[0] || ''
  const delimiters = [';', ',', '\t']
  let delimiter = ','
  let maxCount = 0
  for (const d of delimiters) {
    const count = (firstLine.match(new RegExp(`\\${d}`, 'g')) || []).length
    if (count > maxCount) { maxCount = count; delimiter = d }
  }

  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length === 0) return []

  // Try to find relevant column by header
  const headerLine = lines[0]
  const headers = headerLine.split(delimiter).map((h) => h.trim().toLowerCase().replace(/"/g, ''))

  const colNames = ['isin', 'wkn', 'ticker', 'symbol', 'mnemonic']
  const colIdx = colNames.map((name) => headers.findIndex((h) => h === name))
  const relevantCol = colIdx.find((idx) => idx >= 0)

  const allTokens: string[] = []

  if (relevantCol !== undefined && relevantCol >= 0) {
    // Use specific column
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/"/g, ''))
      const val = cells[relevantCol]
      if (val) allTokens.push(val)
    }
  } else {
    // Scan all cells for valid identifiers
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/"/g, ''))
      for (const cell of cells) {
        if (ISIN_REGEX.test(cell) || WKN_REGEX.test(cell)) {
          allTokens.push(cell)
        }
      }
    }
  }

  return parseManualInput(allTokens.join('\n'))
}

// ─── Instrument Type from OpenFIGI ───────────────────────────────────────────

export function resolveInstrumentType(
  figiSecType: string | null | undefined,
  figiSecType2: string | null | undefined,
  isin: string
): Instrument['type'] {
  // securityType2 = "Common Stock" is reliable
  if (figiSecType2 === 'Common Stock') return 'Stock'

  // securityType2 ETF/ETC direct
  if (figiSecType2 === 'ETF') return 'ETF'
  if (figiSecType2 === 'ETC') return 'ETC'

  // securityType ETP → could be ETF or ETC, treat as ETF for now (justETF will confirm)
  if (figiSecType === 'ETP') return 'ETF'

  // securityType2 "Mutual Fund" is unreliable – treat same as ETP
  if (figiSecType2 === 'Mutual Fund') return 'ETF'

  // XS ISINs are typically ETCs (structured as notes)
  if (isin.startsWith('XS')) return 'ETC'

  return 'Unknown'
}

// Build display name from OpenFIGI ALL CAPS name
export function toDisplayName(longName: string | undefined, fallback: string): string {
  if (!longName) return fallback
  // Convert ALL CAPS to Title Case
  return longName
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEtf\b/g, 'ETF')
    .replace(/\bEtc\b/g, 'ETC')
    .replace(/\bUcits\b/g, 'UCITS')
    .replace(/\bMsci\b/g, 'MSCI')
    .replace(/\bFtse\b/g, 'FTSE')
    .replace(/\bS&p\b/g, 'S&P')
    .replace(/\bEsr\b/g, 'ESR')
    .replace(/\bSri\b/g, 'SRI')
    .replace(/\bPab\b/g, 'PAB')
    .replace(/\bEsg\b/g, 'ESG')
    .replace(/\bUs\b/g, 'US')
    .replace(/\bUsa\b/g, 'USA')
    .replace(/\bEu\b/g, 'EU')
    .replace(/\bEur\b/g, 'EUR')
    .replace(/\bUsd\b/g, 'USD')
    .replace(/\bGbp\b/g, 'GBP')
    .replace(/\bDr\b/g, 'DR')
    .replace(/\bAcc\b/g, 'Acc')
    .replace(/\bDist\b/g, 'Dist')
    .trim()
}
