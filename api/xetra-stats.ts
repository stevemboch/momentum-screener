import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as zlib from 'zlib'
import { promisify } from 'util'
const inflateRaw = promisify(zlib.inflateRaw)

export interface ETFStats {
  isin: string
  name: string | null
  aum: number | null
  ter: null
}

function findZipEntries(buf: Buffer) {
  const entries = new Map<string, { offset: number; compressed: number; method: number }>()
  let i = 0
  while (i < buf.length - 4) {
    if (buf[i]===0x50 && buf[i+1]===0x4B && buf[i+2]===0x03 && buf[i+3]===0x04) {
      const method = buf.readUInt16LE(i + 8)
      const compressed = buf.readUInt32LE(i + 18)
      const nameLen = buf.readUInt16LE(i + 26)
      const extraLen = buf.readUInt16LE(i + 28)
      const name = buf.slice(i + 30, i + 30 + nameLen).toString()
      entries.set(name, { offset: i + 30 + nameLen + extraLen, compressed, method })
      i = i + 30 + nameLen + extraLen + compressed
    } else { i++ }
  }
  return entries
}

async function extractXml(buf: Buffer, entry: { offset: number; compressed: number; method: number }) {
  const data = buf.slice(entry.offset, entry.offset + entry.compressed)
  if (entry.method === 0) return data.toString('utf8')
  return (await inflateRaw(data)).toString('utf8')
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  for (const m of xml.matchAll(/<si>[\s\S]*?<\/si>/g)) {
    strings.push([...m[0].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join(''))
  }
  return strings
}

function colIndex(ref: string): number {
  return ref.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
}

async function fetchXlsxSheet(buf: Buffer, sheetFile: string, strings: string[]): Promise<string[][]> {
  const entries = findZipEntries(buf)
  const wsEntry = entries.get(sheetFile)
  if (!wsEntry) throw new Error(`Sheet ${sheetFile} not found`)
  const wsXml = await extractXml(buf, wsEntry)

  const rows: string[][] = []
  for (const rowMatch of wsXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: { col: number; val: string }[] = []
    for (const cm of rowMatch[1].matchAll(/<c\b r="([A-Z]+)\d+"(?:[^>]*\bt="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)) {
      const val = (cm[2] ?? '') === 's' ? (strings[parseInt(cm[3] ?? '')] ?? '') : (cm[3] ?? '')
      cells.push({ col: colIndex(cm[1]), val })
    }
    if (cells.length === 0) continue
    const maxCol = Math.max(...cells.map(c => c.col))
    const row = Array(maxCol + 1).fill('')
    cells.forEach(c => { row[c.col] = c.val })
    rows.push(row)
  }
  return rows
}

// ETF sheet (sheet3):
// col 2 = Name, col 3 = ISIN, col 12 = AUM (€m, current month)
function parseETFSheet(rows: string[][]): Map<string, { name: string | null; aum: number | null }> {
  const map = new Map<string, { name: string | null; aum: number | null }>()
  for (const row of rows) {
    const isin = row[3]?.trim()
    if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) continue
    const name = row[2]?.trim() || null
    const aumRaw = parseFloat(row[12])
    const aum = isFinite(aumRaw) && aumRaw > 0 ? Math.round(aumRaw * 1_000_000) : null
    map.set(isin, { name, aum })
  }
  return map
}

// ETC sheet (sheet4):
// col 2 = Name, col 3 = ISIN, col 9 = AUM (€m, current month)
function parseETCSheet(rows: string[][]): Map<string, { name: string | null; aum: number | null }> {
  const map = new Map<string, { name: string | null; aum: number | null }>()
  for (const row of rows) {
    const isin = row[3]?.trim()
    if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) continue
    const name = row[2]?.trim() || null
    const aumRaw = parseFloat(row[9])
    const aum = isFinite(aumRaw) && aumRaw > 0 ? Math.round(aumRaw * 1_000_000) : null
    map.set(isin, { name, aum })
  }
  return map
}

async function findLatestStatsUrl(): Promise<string> {
  const pageRes = await fetch(
    'https://www.cashmarket.deutsche-boerse.com/cash-en/Data-Tech/statistics/etf-etp-statistics',
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } }
  )
  if (!pageRes.ok) throw new Error(`Stats page HTTP ${pageRes.status}`)
  const html = await pageRes.text()

  const patterns = [
    /href="(\/resource\/blob\/[^"]*ETF-ETP-Statistic[^"]*\.xlsx)"/i,
    /href="(\/resource\/blob\/[^"]*Statistic[^"]*\.xlsx)"/i,
    /href="(\/resource\/blob\/[^"]*ETF[^"]*\.xlsx)"/i,
    /href="([^"]*blob[^"]*\.xlsx)"/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      const href = match[1]
      return href.startsWith('http') ? href : 'https://www.cashmarket.deutsche-boerse.com' + href
    }
  }
  throw new Error(`No XLSX URL found (html size: ${html.length})`)
}

// Module-level cache shared across warm Vercel invocations
let cache: { ts: number; data: Map<string, { name: string | null; aum: number | null }> } | null = null
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

async function getStatsMap(): Promise<Map<string, { name: string | null; aum: number | null }>> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data

  const url = await findLatestStatsUrl()
  const fileRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } })
  if (!fileRes.ok) throw new Error(`XLSX HTTP ${fileRes.status}`)

  const buf = Buffer.from(await fileRes.arrayBuffer())
  const entries = findZipEntries(buf)
  const strings = parseSharedStrings(await extractXml(buf, entries.get('xl/sharedStrings.xml')!))

  const [etfRows, etcRows] = await Promise.all([
    fetchXlsxSheet(buf, 'xl/worksheets/sheet3.xml', strings),
    fetchXlsxSheet(buf, 'xl/worksheets/sheet4.xml', strings),
  ])

  const data = new Map([
    ...parseETFSheet(etfRows),
    ...parseETCSheet(etcRows),
  ])

  cache = { ts: Date.now(), data }
  return data
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const isins: string[] = req.body?.isins
  if (!Array.isArray(isins) || isins.length === 0) {
    return res.status(400).json({ error: 'isins array required' })
  }

  try {
    const statsMap = await getStatsMap()
    const results: ETFStats[] = isins.map(isin => {
      const entry = statsMap.get(isin)
      return { isin, name: entry?.name ?? null, aum: entry?.aum ?? null, ter: null }
    })
    return res.status(200).json(results)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
