import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/4944224/f2d175ed4b2c4d8bae681a0bba3044d0/data/20260131-ETF-ETP-Statistic.xlsx'

  const res2 = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': '*/*' }
  })

  if (!res2.ok) {
    return res.status(502).json({ error: `HTTP ${res2.status}` })
  }

  // Read first 2000 bytes as text to see if it's readable or binary
  const buffer = await res2.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const size = bytes.length

  // Check magic bytes - XLSX is a ZIP file starting with PK
  const magic = String.fromCharCode(bytes[0], bytes[1])
  
  // Try to find any readable strings in first 5000 bytes (column headers often readable in xlsx)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 5000))
  const readable = text.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)

  return res.status(200).json({
    status: res2.status,
    size_bytes: size,
    magic,
    is_zip: magic === 'PK',
    readable_snippet: readable,
  })
}
