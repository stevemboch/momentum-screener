const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
}

export async function geminiChat(
  systemPrompt: string,
  userMessage: string,
  model = 'gemini-2.5-flash'
): Promise<string> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY')

  const res = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  })

  if (!res.ok) {
    let msg = `Gemini API error: ${res.status}`
    try {
      const err = await res.json()
      if (err?.error?.message) msg = `Gemini API error: ${err.error.message}`
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(msg)
  }

  const data = await res.json()
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text)
    .filter(Boolean)
    .join('')
  if (!text) throw new Error('Empty response from Gemini')
  return text
}
