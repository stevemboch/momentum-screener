import { GoogleGenerativeAI } from '@google/generative-ai'
import pRetry from 'p-retry'
import { openrouterChat } from './openrouter'

function getGeminiApiKey(): string {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || ''
}

function hasGeminiApiKey(): boolean {
  return getGeminiApiKey().length > 0
}

function hasOpenRouterApiKey(): boolean {
  return typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY.trim().length > 0
}

function getGenAI(): GoogleGenerativeAI {
  const apiKey = getGeminiApiKey()
  if (!apiKey) throw new Error('Missing GOOGLE_AI_API_KEY')
  return new GoogleGenerativeAI(apiKey)
}

type SearchToolMode = 'googleSearch' | 'googleSearchRetrieval' | 'openrouterFallback'

export interface SearchChatMeta {
  modelId: string
  searchMode: SearchToolMode
  jsonResponseMode: boolean
}

export interface SearchChatResult {
  text: string
  meta: SearchChatMeta
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function extractStatusCode(err: unknown): number | null {
  const candidate = err as any
  const code = candidate?.status ?? candidate?.code ?? candidate?.statusCode ?? candidate?.response?.status
  return typeof code === 'number' && Number.isFinite(code) ? code : null
}

function isRetryableSearchError(err: unknown): boolean {
  const statusCode = extractStatusCode(err)
  if (statusCode && [408, 429, 500, 502, 503, 504].includes(statusCode)) return true

  const msg = toErrorMessage(err).toLowerCase()
  return (
    msg.includes('timeout')
    || msg.includes('timed out')
    || msg.includes('deadline exceeded')
    || msg.includes('econnreset')
    || msg.includes('etimedout')
    || msg.includes('429')
    || msg.includes('503')
    || msg.includes('504')
    || msg.includes('service unavailable')
    || msg.includes('temporarily unavailable')
  )
}

async function generateSearchContentWithTimeout(model: any, userMessage: string, timeoutMs = 45_000) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const result = await Promise.race([
      model.generateContent(userMessage),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gemini search timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
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

function shouldDisableJsonResponseMode(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('responsemimetype')
    || m.includes('response_mime_type')
    || m.includes('json schema')
    || m.includes('unsupported')
  )
}

function createSearchModel(
  modelId: string,
  systemPrompt: string,
  mode: SearchToolMode,
  jsonResponseMode: boolean,
) {
  // SDK 0.21.0 typings do not include googleSearch, but API supports it.
  const modelParams: any = {
    model: modelId,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.1,
    },
  }
  if (jsonResponseMode) {
    modelParams.generationConfig.responseMimeType = 'application/json'
  }
  modelParams.tools = mode === 'googleSearch'
    ? [{ googleSearch: {} }]
    : [{ googleSearchRetrieval: {} }]
  return getGenAI().getGenerativeModel(modelParams)
}

function ensureAnyAiProviderConfigured() {
  if (hasGeminiApiKey() || hasOpenRouterApiKey()) return
  throw new Error('No AI provider configured: set GOOGLE_AI_API_KEY (or GEMINI_API_KEY) or OPENROUTER_API_KEY')
}

async function openRouterFallbackChat(systemPrompt: string, userMessage: string): Promise<string> {
  if (!hasOpenRouterApiKey()) {
    throw new Error('OpenRouter fallback unavailable: missing OPENROUTER_API_KEY')
  }
  return openrouterChat(systemPrompt, userMessage)
}

export async function geminiChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  ensureAnyAiProviderConfigured()

  if (!hasGeminiApiKey()) {
    return openRouterFallbackChat(systemPrompt, userMessage)
  }

  const modelFallbacks = [
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

  if (hasOpenRouterApiKey()) {
    try {
      return await openRouterFallbackChat(systemPrompt, userMessage)
    } catch (fallbackErr: unknown) {
      const primaryMsg = toErrorMessage(lastError)
      const fallbackMsg = toErrorMessage(fallbackErr)
      throw new Error(`Gemini failed: ${primaryMsg}. OpenRouter fallback failed: ${fallbackMsg}`)
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Gemini failed: no models available')
}

export async function geminiSearchChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const result = await geminiSearchChatWithMeta(systemPrompt, userMessage)
  return result.text
}

export async function geminiSearchChatWithMeta(
  systemPrompt: string,
  userMessage: string
): Promise<SearchChatResult> {
  ensureAnyAiProviderConfigured()

  if (!hasGeminiApiKey()) {
    const text = await openRouterFallbackChat(systemPrompt, userMessage)
    return {
      text,
      meta: {
        modelId: 'openrouter-fallback',
        searchMode: 'openrouterFallback',
        jsonResponseMode: false,
      },
    }
  }

  try {
    return await pRetry(async () => {
    const modelFallbacks = [
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
    ]

    let lastError: unknown = null
    for (const modelId of modelFallbacks) {
      const isGemma = modelId.startsWith('gemma')
      if (isGemma) continue

      let mode: SearchToolMode = 'googleSearch'
      const attemptedModes = new Set<SearchToolMode>()

      while (!attemptedModes.has(mode)) {
        attemptedModes.add(mode)
        let jsonResponseMode = true
        let attemptedWithoutJsonMode = false
        try {
          while (true) {
            const model = createSearchModel(modelId, systemPrompt, mode, jsonResponseMode)
            const result = await generateSearchContentWithTimeout(model, userMessage)
            const text = result.response.text()
            if (!text) throw new Error(`Leere Antwort von Gemini (${modelId})`)
            return {
              text,
              meta: {
                modelId,
                searchMode: mode,
                jsonResponseMode,
              },
            }
          }
        } catch (err) {
          lastError = err
          const msg = toErrorMessage(err)

          if (jsonResponseMode && !attemptedWithoutJsonMode && shouldDisableJsonResponseMode(msg)) {
            attemptedWithoutJsonMode = true
            jsonResponseMode = false
            try {
              const model = createSearchModel(modelId, systemPrompt, mode, jsonResponseMode)
              const result = await generateSearchContentWithTimeout(model, userMessage)
              const text = result.response.text()
              if (!text) throw new Error(`Leere Antwort von Gemini (${modelId})`)
              return {
                text,
                meta: {
                  modelId,
                  searchMode: mode,
                  jsonResponseMode,
                },
              }
            } catch (retryErr) {
              lastError = retryErr
            }
          }

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
  }, {
    retries: 3,
    minTimeout: 1000,
    factor: 2,
    randomize: false,
    shouldRetry: ({ error }) => isRetryableSearchError(error),
  })
  } catch (err: unknown) {
    if (!hasOpenRouterApiKey()) throw err
    const text = await openRouterFallbackChat(systemPrompt, userMessage)
    return {
      text,
      meta: {
        modelId: 'openrouter-fallback',
        searchMode: 'openrouterFallback',
        jsonResponseMode: false,
      },
    }
  }
}

export async function parseJSONWithRepair<T>(
  raw: string,
  schemaHint: string,
): Promise<{ value: T; repaired: boolean }> {
  try {
    return { value: parseJSON<T>(raw), repaired: false }
  } catch {
    const repairSystemPrompt = `You are a JSON repair utility.
Return ONLY valid JSON. No commentary, no markdown, no code fences.`
    const repairMessage = `Fix the following malformed JSON so it matches this schema contract.
Do not invent fields that are not in the contract. If a value is unknown, use null.

Schema contract:
${schemaHint}

Malformed JSON:
${raw}`
    const repairedRaw = await geminiChat(repairSystemPrompt, repairMessage)
    return { value: parseJSON<T>(repairedRaw), repaired: true }
  }
}

export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}
