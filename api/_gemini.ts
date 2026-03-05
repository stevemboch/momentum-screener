import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!)

export async function geminiChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  })
  const result = await model.generateContent(userMessage)
  const text = result.response.text()
  if (!text) throw new Error('Leere Antwort von Gemini')
  return text
}

export async function geminiSearchChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    tools: [{ googleSearch: {} }],
  })
  const result = await model.generateContent(userMessage)
  const text = result.response.text()
  if (!text) throw new Error('Leere Antwort von Gemini')
  return text
}

export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}
