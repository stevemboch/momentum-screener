export class ApiError extends Error {
  status: number
  payload: any

  constructor(message: string, status: number, payload: any = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function mergeAbortSignals(timeoutMs: number | undefined, externalSignal?: AbortSignal | null): {
  signal?: AbortSignal
  cleanup: () => void
} {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: externalSignal ?? undefined, cleanup: () => {} }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let externalAbortHandler: (() => void) | null = null

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalAbortHandler = () => controller.abort()
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler)
      }
    },
  }
}

export async function apiFetch(path: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs, signal: externalSignal, ...requestInit } = init
  const { signal, cleanup } = mergeAbortSignals(timeoutMs, externalSignal)
  try {
    const res = await fetch(path, {
      ...requestInit,
      signal,
      credentials: 'include',
    })
    if (res.status === 401) {
      unauthorizedHandler?.()
      throw new ApiError('Unauthorized', 401)
    }
    return res
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('Request timed out', 408)
    }
    throw err
  } finally {
    cleanup()
  }
}

export async function apiFetchJson<T = any>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, init)
  const data = await parseJsonSafe(res)
  if (!res.ok) {
    throw new ApiError(data?.error || `API error: ${res.status}`, res.status, data)
  }
  return data as T
}

export async function apiFetchText(path: string, init: ApiFetchOptions = {}): Promise<string> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  if (!res.ok) {
    throw new ApiError(text || `API error: ${res.status}`, res.status)
  }
  return text
}
