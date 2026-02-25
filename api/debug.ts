import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as zlib from 'zlib'
import { promisify } from 'util'
const inflateRaw = promisify(zlib.inflateRaw)

function findZipEntries(buf: Buffer) {
  const entries = new Map<string, { offset: number, compressed: number, method: number }>()
  let i = 0
  while (i < buf.length - 4) {
    if (buf[i]===0x50 && buf[i+1]===0x4B && buf[i+2]===0x03 && buf[i+3]===0x04) {
      const method = buf.readUInt16LE(i+8)
      const compressed = buf.readUInt32LE(i+18)
      const nameLen = buf.readUInt16LE(i+26)
      const extraLen = buf.readUInt16LE(i+28)
      const name = buf.slice(i+30, i+30+nameLen).toString()
      entries.set(name, { offset: i+30+nameLen+extraLen, compressed, method })
      i = i+30+nameLen+extraLen+compressed
    } else { i++ }
  }
  return entries
}

async function extractXml(buf: Buffer, entry: { offset: number, compressed: number, method: number }) {
  const data = buf.slice(entry.offset, entry.offset + entry.compressed)
  if (entry.method === 0) return data.toString('utf8')
  return (await inflateRaw(data)).toString('utf8')
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  for (const m of xml.matchAll(/<si>[\s\S]*?<\/si>/g)) {
    const texts = [...m[0].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')
    strings.push(texts)
  }
  return strings
}

function parseRows(wsXml: string, strings: string[], maxRows = 10): string[][] {
  const rows: string[][] = []
  for (const rowMatch of wsXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) break
    const cells: { col: number, val: string }[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<c\b r="([A-Z]+)\d+"(?:[^>]*\bt="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)) {
      const col = cellMatch[1].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
      const type = cellMatch[2] ?? ''
      const raw = cellMatch[3] ?? ''
      cells.push({ col, val: type === 's' ? (strings[parseInt(raw)] ?? '') : raw })
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
    const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/4944224/f2d175ed4b2c4d8bae681a0bba3044d0/data/20260131-ETF-ETP-Statistic.xlsx'
    const fetchRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } })
    const buf = Buffer.from(await fetchRes.arrayBuffer())
    const entries = findZipEntries(buf)

    const strings = parseSharedStrings(await extractXml(buf, entries.get('xl/sharedStrings.xml')!))
    const wsXml = await extractXml(buf, entries.get('xl/worksheets/sheet3.xml')!) // Exchange Traded Funds
    const rows = parseRows(wsXml, strings, 10)

    return res.status(200).json({ rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
