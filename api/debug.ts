import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch('https://momentum-screener-seven.vercel.app/api/xetra-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isins: ['IE00B4L5Y983', 'IE00B5BMR087', 'IE00BK5BQT80'] })
    })
    const data = await r.json()
    return res.status(200).json({ status: r.status, data })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
