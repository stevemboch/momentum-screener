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

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
  })
  if (res.status === 401) {
    unauthorizedHandler?.()
    throw new ApiError('Unauthorized', 401)
  }
  return res
}

export async function apiFetchJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init)
  const data = await parseJsonSafe(res)
  if (!res.ok) {
    throw new ApiError(data?.error || `API error: ${res.status}`, res.status, data)
  }
  return data as T
}

export async function apiFetchText(path: string, init: RequestInit = {}): Promise<string> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  if (!res.ok) {
    throw new ApiError(text || `API error: ${res.status}`, res.status)
  }
  return text
}
