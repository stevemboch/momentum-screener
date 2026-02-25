import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as zlib from 'zlib'
import { promisify } from 'util'
const inflateRaw = promisify(zlib.inflateRaw)

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

async function parseSheet(buf: Buffer, sheetFile: string, strings: string[]): Promise<string[][]> {
  const entries = findZipEntries(buf)
  const wsEntry = entries.get(sheetFile)
  if (!wsEntry) return []
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const pageRes = await fetch(
      'https://www.cashmarket.deutsche-boerse.com/cash-en/Data-Tech/statistics/etf-etp-statistics',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } }
    )
    const html = await pageRes.text()
    const match = html.match(/href="(\/resource\/blob\/[^"]*ETF-ETP-Statistic[^"]*\.xlsx)"/i)
      || html.match(/href="(\/resource\/blob\/[^"]*Statistic[^"]*\.xlsx)"/i)
      || html.match(/href="([^"]*blob[^"]*\.xlsx)"/i)
    if (!match) return res.status(500).json({ error: 'URL not found' })

    const url = 'https://www.cashmarket.deutsche-boerse.com' + match[1]
    const fileRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } })
    const buf = Buffer.from(await fileRes.arrayBuffer())
    const entries = findZipEntries(buf)
    const strings = parseSharedStrings(await extractXml(buf, entries.get('xl/sharedStrings.xml')!))

    const etcRows = await parseSheet(buf, 'xl/worksheets/sheet4.xml', strings)

    return res.status(200).json({
      etc_row_count: etcRows.length,
      etc_first_6_rows: etcRows.slice(0, 6)
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
