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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/4944224/f2d175ed4b2c4d8bae681a0bba3044d0/data/20260131-ETF-ETP-Statistic.xlsx'
    const fetchRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } })
    const buf = Buffer.from(await fetchRes.arrayBuffer())
    const entries = findZipEntries(buf)

    // List all files in the ZIP
    const allFiles = [...entries.keys()]

    // Parse workbook.xml to get sheet names
    const wbEntry = entries.get('xl/workbook.xml')
    const wbXml = wbEntry ? await extractXml(buf, wbEntry) : ''
    const sheets = [...wbXml.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)]
      .map(m => ({ name: m[1], id: m[2] }))

    // Parse sheet names from relationships
    const relsEntry = entries.get('xl/_rels/workbook.xml.rels')
    const relsXml = relsEntry ? await extractXml(buf, relsEntry) : ''
    const rels = [...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g)]
      .map(m => ({ id: m[1], target: m[2] }))

    return res.status(200).json({ all_files: allFiles, sheets, rels })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
