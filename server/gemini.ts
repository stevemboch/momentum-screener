import { GoogleGenerativeAI } from '@google/generative-ai'

function getGeminiApiKey(): string {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || ''
}

function getGenAI(): GoogleGenerativeAI {
  const apiKey = getGeminiApiKey()
  if (!apiKey) throw new Error('Missing GOOGLE_AI_API_KEY')
  return new GoogleGenerativeAI(apiKey)
}

type SearchToolMode = 'googleSearch' | 'googleSearchRetrieval'

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function shouldSwitchToGoogleSearch(message: string): boolean {
  const m = message.toLowerCase()
  return (
    (m.includes('google_search_retrieval') && m.includes('not supported'))
    || m.includes('use google_search tool instead')
  )
}

function shouldSwitchToGoogleSearchRetrieval(message: string): boolean {
  const m = message.toLowerCase()
  return (
    (m.includes('google_search') && m.includes('not supported'))
    || m.includes('use google_search_retrieval tool instead')
  )
}

function createSearchModel(modelId: string, systemPrompt: string, mode: SearchToolMode) {
  // SDK 0.21.0 typings do not include googleSearch, but API supports it.
  const modelParams: any = {
    model: modelId,
    systemInstruction: systemPrompt,
  }
  modelParams.tools = mode === 'googleSearch'
    ? [{ googleSearch: {} }]
    : [{ googleSearchRetrieval: {} }]
  return getGenAI().getGenerativeModel(modelParams)
}

export async function geminiChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const modelFallbacks = [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ]

  let lastError: unknown = null
  for (const modelId of modelFallbacks) {
    try {
      const model = getGenAI().getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
      })
      const result = await model.generateContent(userMessage)
      const text = result.response.text()
      if (!text) throw new Error(`Leere Antwort von Gemini (${modelId})`)
      return text
    } catch (err) {
      lastError = err
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Gemini failed: no models available')
}

export async function geminiSearchChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const modelFallbacks = [
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ]

  let lastError: unknown = null
  for (const modelId of modelFallbacks) {
    const isGemma = modelId.startsWith('gemma')
    if (isGemma) continue

    let mode: SearchToolMode = 'googleSearch'
    const attemptedModes = new Set<SearchToolMode>()

    while (!attemptedModes.has(mode)) {
      attemptedModes.add(mode)
      try {
        const model = createSearchModel(modelId, systemPrompt, mode)
        const result = await model.generateContent(userMessage)
        const text = result.response.text()
        if (!text) throw new Error(`Leere Antwort von Gemini (${modelId})`)
        return text
      } catch (err) {
        lastError = err
        const msg = toErrorMessage(err)

        if (mode === 'googleSearch' && shouldSwitchToGoogleSearchRetrieval(msg) && !attemptedModes.has('googleSearchRetrieval')) {
          mode = 'googleSearchRetrieval'
          continue
        }

        if (mode === 'googleSearchRetrieval' && shouldSwitchToGoogleSearch(msg) && !attemptedModes.has('googleSearch')) {
          mode = 'googleSearch'
          continue
        }

        break
      }
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Gemini failed: no models available')
}

export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}
