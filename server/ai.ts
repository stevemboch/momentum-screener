import { geminiChat } from './gemini'
import { openrouterChat } from './openrouter'

export async function aiChat(
  systemPrompt: string,
  userMessage: string,
  geminiModel = 'gemini-2.5-flash'
): Promise<string> {
  try {
    return await geminiChat(systemPrompt, userMessage)
  } catch (err: any) {
    try {
      return await openrouterChat(systemPrompt, userMessage)
    } catch (fallbackErr: any) {
      const primaryMsg = err?.message || String(err)
      const fallbackMsg = fallbackErr?.message || String(fallbackErr)
      throw new Error(`Gemini failed: ${primaryMsg}. OpenRouter failed: ${fallbackMsg}`)
    }
  }
}
