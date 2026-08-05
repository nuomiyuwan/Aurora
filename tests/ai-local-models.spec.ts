import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAiLocalModelDetector } = require('../electron/aiLocalModels.cjs') as {
  createAiLocalModelDetector(options?: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
  }): {
    detect(): Promise<Array<{
      provider: 'ollama' | 'lm-studio'
      label: string
      baseUrl: string
      models: Array<{
        id: string
        capabilities: Array<'vision' | 'embedding'>
      }>
    }>>
  }
}

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => payload,
  } as Response
}

test('并行检测固定回环地址上的 Ollama 与 LM Studio OpenAI 模型端点', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let activeRequests = 0
  let maximumActiveRequests = 0
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    activeRequests += 1
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
    await new Promise((resolve) => setTimeout(resolve, 12))
    activeRequests -= 1

    if (url === 'http://127.0.0.1:11434/v1/models') {
      return jsonResponse({
        data: [
          { id: 'qwen2.5-vl:7b' },
          { id: 'nomic-embed-text:latest' },
        ],
      })
    }
    if (url === 'http://127.0.0.1:1234/v1/models') {
      return jsonResponse({ data: [{ id: 'local-chat-model' }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const detector = createAiLocalModelDetector({
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 100,
  })
  const detected = await detector.detect()

  expect(maximumActiveRequests).toBe(2)
  expect(calls.map((call) => call.url)).toEqual([
    'http://127.0.0.1:11434/v1/models',
    'http://127.0.0.1:1234/v1/models',
  ])
  expect(calls.every((call) => call.init?.method === 'GET')).toBe(true)
  expect(calls.every((call) => call.init?.redirect === 'error')).toBe(true)
  expect(detected).toEqual([
    {
      provider: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [
        { id: 'qwen2.5-vl:7b', capabilities: ['vision'] },
        { id: 'nomic-embed-text:latest', capabilities: ['embedding'] },
      ],
    },
    {
      provider: 'lm-studio',
      label: 'LM Studio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [{ id: 'local-chat-model', capabilities: [] }],
    },
  ])
})

test('Ollama OpenAI 端点不可用时回退到 api tags 并去重无效模型', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url === 'http://127.0.0.1:11434/v1/models') {
      return jsonResponse({ message: 'missing' }, false)
    }
    if (url === 'http://127.0.0.1:11434/api/tags') {
      return jsonResponse({
        models: [
          { name: 'llava:13b' },
          { name: 'llava:13b' },
          { model: 'bge-m3:latest' },
          { name: '   ' },
          { name: null },
        ],
      })
    }
    if (url === 'http://127.0.0.1:1234/v1/models') {
      throw new Error('LM Studio is not running')
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const detected = await createAiLocalModelDetector({
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 100,
  }).detect()

  expect(calls).toEqual(expect.arrayContaining([
    'http://127.0.0.1:11434/v1/models',
    'http://127.0.0.1:11434/api/tags',
    'http://127.0.0.1:1234/v1/models',
  ]))
  expect(calls.every((url) => url.startsWith('http://127.0.0.1:'))).toBe(true)
  expect(detected).toEqual([
    {
      provider: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [
        { id: 'llava:13b', capabilities: ['vision'] },
        { id: 'bge-m3:latest', capabilities: ['embedding'] },
      ],
    },
  ])
})

test('超时、坏响应和缺少 fetch 都返回空检测结果而不阻断', async () => {
  let abortedRequests = 0
  const neverResolvingFetch = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>(() => {
      init?.signal?.addEventListener('abort', () => {
        abortedRequests += 1
      }, { once: true })
    })

  const startedAt = Date.now()
  const timedOut = await createAiLocalModelDetector({
    fetchImpl: neverResolvingFetch as typeof fetch,
    timeoutMs: 25,
  }).detect()

  expect(timedOut).toEqual([])
  expect(abortedRequests).toBe(3)
  expect(Date.now() - startedAt).toBeLessThan(250)

  const unavailable = await createAiLocalModelDetector({
    fetchImpl: null as unknown as typeof fetch,
  }).detect()
  expect(unavailable).toEqual([])
})

test('有效但为空的 Ollama OpenAI 列表在原生补充端点失败时仍视为已发现', async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input)
    if (url === 'http://127.0.0.1:11434/v1/models') {
      return jsonResponse({ data: [] })
    }
    throw new Error('not available')
  }

  const detected = await createAiLocalModelDetector({
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 100,
  }).detect()

  expect(detected).toEqual([
    {
      provider: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [],
    },
  ])
})
