import type { VercelRequest, VercelResponse } from '@vercel/node'

// Minimal XLSX parser - extracts shared strings and sheet data
function parseXlsx(buffer: ArrayBuffer): { headers: string[], rows: Record<string, string>[] } {
  // XLSX is a ZIP - we need to find xl/sharedStrings.xml and xl/worksheets/sheet1.xml
  // Since we can't use a ZIP library, let's extract XML by finding the file boundaries
  const bytes = new Uint8Array(buffer)
  const text = new TextDecoder('latin1').decode(bytes)

  // Find shared strings (column headers and string values are stored here)
  const ssMatch = text.match(/xl\/sharedStrings\.xml[^]*?(?=PK)/)
  const wsMatch = text.match(/xl\/worksheets\/sheet1\.xml[^]*?(?=PK)/)

  if (!ssMatch || !wsMatch) {
    return { headers: [], rows: [] }
  }

  // Extract shared strings
  const strings: string[] = []
  const siMatches = ssMatch[0].matchAll(/<t[^>]*>([^<]*)<\/t>/g)
  for (const m of siMatches) {
    strings.push(m[1])
  }

  // Extract first 5 rows from sheet
  const rows: string[][] = []
  const rowMatches = wsMatch[0].matchAll(/<row[^>]*>(.*?)<\/row>/gs)
  let rowCount = 0
  for (const rowMatch of rowMatches) {
    if (rowCount++ > 5) break
    const cells: string[] = []
    const cellMatches = rowMatch[1].matchAll(/<c r="[^"]*"(?:\s+t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)
    for (const cell of cellMatches) {
      const type = cell[1]
      const val = cell[2] ?? ''
      if (type === 's') {
        cells.push(strings[parseInt(val)] ?? '')
      } else {
        cells.push(val)
      }
    }
    rows.push(cells)
  }

  const headers = rows[0] ?? []
  const dataRows = rows.slice(1).map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
    return obj
  })

  return { headers, rows: dataRows }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/4944224/f2d175ed4b2c4d8bae681a0bba3044d0/data/20260131-ETF-ETP-Statistic.xlsx'

  const fetchRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': '*/*' }
  })

  if (!fetchRes.ok) return res.status(502).json({ error: `HTTP ${fetchRes.status}` })

  const buffer = await fetchRes.arrayBuffer()
  const { headers, rows } = parseXlsx(buffer)

  return res.status(200).json({ headers, sample_rows: rows })
}
