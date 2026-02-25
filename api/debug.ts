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
    // Step 1: find URL
    const pageRes = await fetch(
      'https://www.cashmarket.deutsche-boerse.com/cash-en/Data-Tech/statistics/etf-etp-statistics',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } }
    )
    const html = await pageRes.text()
    const match = html.match(/href="(\/resource\/blob\/[^"]*ETF-ETP-Statistic\.xlsx)"/)
    if (!match) return res.status(500).json({ error: 'URL not found', html_size: html.length })

    const url = 'https://www.cashmarket.deutsche-boerse.com' + match[1]

    // Step 2: fetch file
    const fileRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } })
    if (!fileRes.ok) return res.status(500).json({ error: `File HTTP ${fileRes.status}` })

    const buf = Buffer.from(await fileRes.arrayBuffer())

    // Step 3: parse ZIP
    const entries = findZipEntries(buf)
    const entryNames = [...entries.keys()]

    // Step 4: try extracting sharedStrings
    const ssEntry = entries.get('xl/sharedStrings.xml')
    if (!ssEntry) return res.status(500).json({ error: 'No sharedStrings', entryNames, buf_size: buf.length })

    const ssXml = await extractXml(buf, ssEntry)

    return res.status(200).json({
      url,
      buf_size: buf.length,
      entry_count: entryNames.length,
      entry_names: entryNames,
      ss_size: ssXml.length,
      ss_snippet: ssXml.slice(0, 500),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) })
  }
}
