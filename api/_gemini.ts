import { GoogleGenerativeAI } from '@google/generative-ai'

function getGeminiApiKey(): string {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || ''
}

function getGenAI(): GoogleGenerativeAI {
  const apiKey = getGeminiApiKey()
  if (!apiKey) throw new Error('Missing GOOGLE_AI_API_KEY')
  return new GoogleGenerativeAI(apiKey)
}

export async function geminiChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const model = getGenAI().getGenerativeModel({
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
  const model = getGenAI().getGenerativeModel({
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
