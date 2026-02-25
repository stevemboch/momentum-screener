import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch('https://momentum-screener-seven.vercel.app/api/xetra-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isins: ['IE00B4L5Y983'] })
    })
    const text = await r.text()
    return res.status(200).json({ status: r.status, body: text.slice(0, 1000) })
  } catch (err: any) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) })
  }
}
