import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://momentum-screener.vercel.app',
    'X-Title': 'Momentum Screener',
  },
})

export async function openrouterChat(
  systemPrompt: string,
  userMessage: string,
  model = 'meta-llama/llama-3.3-70b-instruct:free'
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
  })
  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('Leere Antwort von OpenRouter')
  return text
}

// JSON sicher parsen — entfernt Markdown-Backticks falls vorhanden
export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}
