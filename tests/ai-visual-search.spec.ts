import { expect, test } from '@playwright/test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  createAiVisualSearchService,
  embeddingServiceFingerprint,
  normalizeAiVisualSearchError,
  visionServiceFingerprint,
} = require('../electron/aiVisualSearch.cjs') as {
  createAiVisualSearchService(options: {
    userDataPath: string
    credentialsStore: CredentialsStoreStub
    fetchImpl: typeof fetch
    contactSheetComposer?: {
      compose(input: {
        frames: Array<{
          imageBytes: Buffer
          mimeType: string
          slot: number
        }>
      }): Promise<{
        imageBytes: Buffer
        mimeType: 'image/png'
        columns: number
        rows: number
      }>
    }
  }): AiVisualSearchService
  normalizeAiVisualSearchError(error: unknown): {
    code: string
    message: string
    status: number | null
    retryable: boolean
  }
  visionServiceFingerprint(profile: ProviderProfile | ServiceProfile): string
  embeddingServiceFingerprint(
    profile: ProviderProfile | ServiceProfile,
    descriptionFingerprint: string,
  ): string
}

type ProviderProfile = {
  id: string | null
  name: string
  baseUrl: string
  visionModel: string
  embeddingModel: string
  apiKey: string | null
}

type ServiceProfile = {
  id: string | null
  name: string
  baseUrl: string
  model: string
  apiKey: string | null
}

type ActiveServices = {
  vision: ServiceProfile | null
  embedding: ServiceProfile | null
}

type CredentialsStoreStub = {
  readActiveProfileForMainProcess?(): Promise<ProviderProfile | null>
  resolveProfileInputForMainProcess?(input: unknown): Promise<ProviderProfile>
  readActiveServicesForMainProcess?(): Promise<ActiveServices>
  resolveServiceProfileInputForMainProcess?(
    kind: 'vision' | 'embedding',
    input: unknown,
  ): Promise<ServiceProfile>
}

type AiVisualFrameCandidate = {
  resultId: string
  assetId: string
  clipId: string
  projectId: string
  frameId: string
  sourceFingerprint: string
  imagePath: string
  timeSeconds: number
  filename: string
  projectTitle: string
  tags: string[]
  note: string
  analysisTier?: 'thumbnail' | 'visual-index'
}

type AiVisualSearchResponse = {
  matches: Array<{
    resultId: string
    score: number
    reason: string
    descriptionZh: string
    descriptionEn: string
    keywords: string[]
    timeSeconds: number
  }>
  indexedFrameCount: number
  newlyAnalyzedFrameCount: number
  semanticQuery: string
}

type AiVisualFrameAnalysisResponse = {
  frames: Array<{
    resultId: string
    assetId: string
    frameId: string
    timeSeconds: number
    descriptionZh: string
    descriptionEn: string
    keywordsZh: string[]
    keywordsEn: string[]
  }>
  analyzedFrameCount: number
  newlyAnalyzedFrameCount: number
}

type AiVisualSearchService = {
  cachePath: string
  inspectCache(input: { retainedAssetIds: string[] }): Promise<{
    totalEntries: number
    reclaimableEntries: number
  }>
  cleanCache(input: { retainedAssetIds: string[] }): Promise<{
    totalEntries: number
    reclaimableEntries: number
    removedEntries: number
  }>
  removeAssetCache(input: string | { assetId: string }): Promise<{
    assetId: string
    removedEntries: number
  }>
  search(request: {
    query: string
    candidates: AiVisualFrameCandidate[]
    limit?: number
    profileId?: string | null
    visionProfileId?: string | null
    embeddingProfileId?: string | null
  }): Promise<AiVisualSearchResponse>
  analyzeFrames(request: {
    candidates: AiVisualFrameCandidate[]
    operationId?: string
    profileId?: string | null
    visionProfileId?: string | null
    descriptionStyle?: 'search-index' | 'frame-note'
  }): Promise<AiVisualFrameAnalysisResponse>
  cancelOperation(input: string | { operationId: string }): boolean
  summarizeFrameSequence(request: {
    frames: Array<{
      frameId: string
      timeSeconds: number
      note: string
      tags: string[]
      imagePath?: string
    }>
    profileId?: string | null
    visionProfileId?: string | null
  }): Promise<{
    note: string
    tags: string[]
    cameraMotion: {
      type: string
      label: string
      confidence: number
    } | null
  }>
  testProfile(input: unknown): Promise<{
    vision: { ok: true; model: string }
    embedding: { ok: true; model: string; dimensions: number }
    latencyMs: number
  }>
  testVisionProfile(input: unknown): Promise<{
    ok: true
    model: string
    latencyMs: number
  }>
  testEmbeddingProfile(input: unknown): Promise<{
    ok: true
    model: string
    dimensions: number
    latencyMs: number
  }>
}

const temporaryDirectories: string[] = []

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function vector(dimensions: number, first: number, second: number) {
  return Array.from({ length: dimensions }, (_, index) => {
    if (index === 0) return first
    if (index === 1) return second
    return 0
  })
}

function jsonResponse(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  } as Response
}

function expectedVisionFrameCount(body: Record<string, unknown>) {
  const responseFormat = body.response_format as {
    json_schema?: {
      schema?: {
        properties?: {
          frames?: { minItems?: number }
        }
      }
    }
  } | undefined
  const schemaCount = responseFormat?.json_schema?.schema?.properties?.frames
    ?.minItems
  if (Number.isInteger(schemaCount)) return Number(schemaCount)
  const messages = body.messages as Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
  const prompt = messages?.[0]?.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n') ?? ''
  const match = prompt.match(/必须准确返回\s+(\d+)\s+项/)
  return match ? Number(match[1]) : 0
}

function validVisionFrames(count: number) {
  return Array.from({ length: count }, (_, slot) => ({
    slot,
    descriptionZh: `画面 ${slot}`,
    descriptionEn: `Frame ${slot}`,
    keywordsZh: [`画面${slot}`],
    keywordsEn: [`frame ${slot}`],
  }))
}

function createCompatibleProviderMock({
  rejectStructuredOutput = false,
  fencedJson = false,
} = {}) {
  const calls: Array<{
    url: string
    body: Record<string, unknown>
    authorization: string | null
    redirect: RequestRedirect | undefined
  }> = []
  let visionIndexCalls = 0
  let connectionVisionCalls = 0
  let embeddingCalls = 0
  let structuredRejected = false

  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({
      url: String(url),
      body,
      authorization: new Headers(init?.headers).get('Authorization'),
      redirect: init?.redirect,
    })

    if (String(url).endsWith('/chat/completions')) {
      const messages = body.messages as Array<{
        content: Array<{ type: string; text?: string }>
      }>
      const serialized = JSON.stringify(messages)
      const connectionTest = serialized.includes('连接测试')
      const connectionTestIndex = connectionVisionCalls
      if (connectionTest) {
        connectionVisionCalls += 1
      } else {
        visionIndexCalls += 1
      }

      if (
        rejectStructuredOutput &&
        body.response_format &&
        !structuredRejected
      ) {
        structuredRejected = true
        return jsonResponse({ error: { message: 'response_format unsupported' } }, 400)
      }

      const responseFormat = body.response_format as {
        json_schema?: { name?: string }
      } | undefined
      if (
        responseFormat?.json_schema?.name ===
        'aurora_frame_sequence_summary'
      ) {
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                note: '人物由远景逐渐接近镜头',
                tags: ['人物', '户外'],
                cameraMotion: { type: 'push-in', confidence: 0.88 },
              }),
            },
          }],
        })
      }

      const imageCount = messages[0].content.filter(
        (item) => item.type === 'image_url',
      ).length
      const frames = Array.from({ length: imageCount }, (_, slot) => {
        if (connectionTest) {
          const red = connectionTestIndex === 0
          return {
            slot,
            descriptionZh: red ? '纯红色画面' : '纯蓝色画面',
            descriptionEn: red ? 'Solid red image' : 'Solid blue image',
            keywordsZh: [red ? '红色' : '蓝色'],
            keywordsEn: [red ? 'red' : 'blue'],
          }
        }
        const snowy = slot < 2
        return {
          slot,
          descriptionZh: snowy ? '雪山峡谷中的蓝色晨雾' : '夜晚城市街道与霓虹灯',
          descriptionEn: snowy
            ? 'Blue morning mist in a snowy mountain valley'
            : 'Neon lights on a city street at night',
          keywordsZh: snowy ? ['雪山', '晨雾', '蓝色'] : ['城市', '夜景', '霓虹'],
          keywordsEn: snowy
            ? ['snow mountain', 'mist', 'blue']
            : ['city', 'night', 'neon'],
        }
      })
      const content = JSON.stringify({ frames })
      return jsonResponse({
        choices: [
          {
            message: {
              content: fencedJson ? `\`\`\`json\n${content}\n\`\`\`` : content,
            },
          },
        ],
      })
    }

    if (String(url).endsWith('/embeddings')) {
      embeddingCalls += 1
      const input = body.input as string[]
      const dimensions = String(body.model).includes('four-dim') ? 4 : 3
      return jsonResponse({
        data: input.map((text, index) => ({
          index,
          embedding:
            text.includes('雪') || text.toLowerCase().includes('snow')
              ? vector(dimensions, 1, 0)
              : vector(dimensions, 0, 1),
        })),
      })
    }

    return jsonResponse({ error: { message: 'unknown endpoint' } }, 404)
  }

  return {
    fetchImpl: fetchImpl as typeof fetch,
    calls,
    get visionIndexCalls() {
      return visionIndexCalls
    },
    get connectionVisionCalls() {
      return connectionVisionCalls
    },
    get embeddingCalls() {
      return embeddingCalls
    },
  }
}

function createHarness() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'aurora-ai-search-'))
  temporaryDirectories.push(userDataPath)
  const frameDirectory = path.join(userDataPath, 'media', 'asset-hash', 'index', 'v3')
  mkdirSync(frameDirectory, { recursive: true })
  const framePaths = [0, 1, 2].map((index) => {
    const framePath = path.join(frameDirectory, `frame-${index}.jpg`)
    writeFileSync(framePath, Buffer.from(`fake-jpeg-${index}`))
    return framePath
  })

  const candidates = framePaths.map((imagePath, index) => ({
    resultId: `local:frame:clip-1:frame-${index}`,
    assetId: 'asset-1',
    clipId: 'clip-1',
    projectId: 'project-1',
    frameId: `frame-${index}`,
    sourceFingerprint: 'fingerprint-v1',
    imagePath,
    timeSeconds: index === 2 ? 10 : index * 2,
    filename: 'secret-local-filename.mov',
    projectTitle: 'private project title',
    tags: [],
    note: '',
  }))

  return { userDataPath, candidates }
}

function cloudProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'profile-one',
    name: '兼容模型服务',
    baseUrl: 'https://models.example.com/openai/v1',
    visionModel: 'custom-vision-model',
    embeddingModel: 'custom-embedding-model',
    apiKey: 'provider-key-unit-test',
    ...overrides,
  }
}

function serviceProfile(
  kind: 'vision' | 'embedding',
  overrides: Partial<ServiceProfile> = {},
): ServiceProfile {
  return {
    id: `${kind}-profile-one`,
    name: kind === 'vision' ? '画面理解服务' : '语义检索服务',
    baseUrl: `https://${kind}.example.com/openai/v1`,
    model: kind === 'vision' ? 'split-vision-model' : 'split-embedding-model',
    apiKey: `${kind}-key-unit-test`,
    ...overrides,
  }
}

test('兼容 chat/completions 与动态维数 embeddings，并跨重启复用缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  let activeProfile = cloudProfile()
  const credentialsStore: CredentialsStoreStub = {
    readActiveProfileForMainProcess: async () => activeProfile,
    resolveProfileInputForMainProcess: async () => activeProfile,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore,
    fetchImpl: provider.fetchImpl,
  })

  const first = await service.search({
    query: '找一个蓝色雪山晨雾的画面',
    candidates,
    limit: 9,
  })

  expect(first.indexedFrameCount).toBe(3)
  expect(first.newlyAnalyzedFrameCount).toBe(3)
  expect(first.matches.map((match) => match.resultId)).toEqual([
    candidates[0].resultId,
  ])
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(2)
  expect(provider.calls.every((call) => call.redirect === 'error')).toBe(true)
  expect(provider.calls.every((call) => call.authorization === 'Bearer provider-key-unit-test')).toBe(true)
  expect(provider.calls.some((call) => call.url.endsWith('/chat/completions'))).toBe(true)
  expect(provider.calls.some((call) => call.url.endsWith('/embeddings'))).toBe(true)
  expect(provider.calls.some((call) => call.body.model === 'custom-vision-model')).toBe(true)
  expect(provider.calls.some((call) => call.body.model === 'custom-embedding-model')).toBe(true)

  const cacheText = readFileSync(service.cachePath, 'utf8')
  expect(cacheText).not.toContain('provider-key-unit-test')
  expect(cacheText).toContain('"embeddingDimensions":3')
  expect(cacheText).toContain('"embeddingBase64"')
  expect(cacheText).not.toContain('"embedding":[')
  const descriptionFingerprint = visionServiceFingerprint(activeProfile)
  expect(cacheText).toContain(descriptionFingerprint)
  expect(cacheText).toContain(
    embeddingServiceFingerprint(activeProfile, descriptionFingerprint),
  )

  const restarted = createAiVisualSearchService({
    userDataPath,
    credentialsStore,
    fetchImpl: provider.fetchImpl,
  })
  const second = await restarted.search({
    query: 'snowy blue valley',
    candidates,
    limit: 9,
  })
  expect(second.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(3)

  activeProfile = cloudProfile({ embeddingModel: 'four-dim-embedding-model' })
  const changedProvider = await restarted.search({
    query: '雪山',
    candidates,
    limit: 9,
  })
  expect(changedProvider.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(5)
  expect(readFileSync(service.cachePath, 'utf8')).toContain(
    embeddingServiceFingerprint(activeProfile, descriptionFingerprint),
  )
})

test('删除素材时只清理该素材的语义视觉缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const profile = cloudProfile()
  const credentialsStore: CredentialsStoreStub = {
    readActiveProfileForMainProcess: async () => profile,
    resolveProfileInputForMainProcess: async () => profile,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore,
    fetchImpl: provider.fetchImpl,
  })

  await service.search({ query: '雪山', candidates, limit: 9 })
  const cache = JSON.parse(readFileSync(service.cachePath, 'utf8')) as {
    version: number
    entries: Record<string, Record<string, unknown>>
  }
  const retainedEntry = {
    ...Object.values(cache.entries)[0],
    assetId: 'asset-2',
    frameId: 'asset-2-frame',
  }
  cache.entries['f'.repeat(64)] = retainedEntry
  writeFileSync(service.cachePath, JSON.stringify(cache))

  const result = await service.removeAssetCache('asset-1')
  const cleaned = JSON.parse(readFileSync(service.cachePath, 'utf8')) as {
    entries: Record<string, { assetId: string }>
  }
  expect(result.removedEntries).toBeGreaterThan(0)
  expect(Object.values(cleaned.entries)).toEqual([
    expect.objectContaining({ assetId: 'asset-2' }),
  ])
})

test('cache cleanup keeps semantic entries for retained assets', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const profile = cloudProfile()
  const credentialsStore: CredentialsStoreStub = {
    readActiveProfileForMainProcess: async () => profile,
    resolveProfileInputForMainProcess: async () => profile,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore,
    fetchImpl: provider.fetchImpl,
  })

  await service.search({ query: '雪山', candidates, limit: 9 })
  const cache = JSON.parse(readFileSync(service.cachePath, 'utf8')) as {
    version: number
    entries: Record<string, Record<string, unknown>>
  }
  const orphanEntryCount = Object.keys(cache.entries).length
  cache.entries['f'.repeat(64)] = {
    ...Object.values(cache.entries)[0],
    assetId: 'retained-asset',
    frameId: 'retained-frame',
  }
  writeFileSync(service.cachePath, JSON.stringify(cache))

  await expect(
    service.inspectCache({ retainedAssetIds: ['retained-asset'] }),
  ).resolves.toEqual({
    totalEntries: orphanEntryCount + 1,
    reclaimableEntries: orphanEntryCount,
  })
  await expect(
    service.cleanCache({ retainedAssetIds: ['retained-asset'] }),
  ).resolves.toEqual({
    totalEntries: 1,
    reclaimableEntries: 0,
    removedEntries: orphanEntryCount,
  })
  const cleaned = JSON.parse(readFileSync(service.cachePath, 'utf8')) as {
    entries: Record<string, { assetId: string }>
  }
  expect(Object.values(cleaned.entries)).toEqual([
    expect.objectContaining({ assetId: 'retained-asset' }),
  ])
})

test('语义分数不高于通用画面基线时不硬返回无关结果', async () => {
  const { userDataPath, candidates } = createHarness()
  const profile = cloudProfile()
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/chat/completions')) {
      const count = expectedVisionFrameCount(body)
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              frames: Array.from({ length: count }, (_, slot) => ({
                slot,
                descriptionZh: '白天的工业变电站与输电设备',
                descriptionEn: 'Industrial power substation in daylight',
                keywordsZh: ['工业', '电网', '白天'],
                keywordsEn: ['industry', 'power grid', 'daylight'],
              })),
            }),
          },
        }],
      })
    }
    const input = body.input as string[]
    return jsonResponse({
      data: input.map((text, index) => ({
        index,
        embedding: text.includes('日落')
          ? vector(3, 1, 0)
          : text.includes('普通的影视画面')
            ? vector(3, 0, 1)
            : vector(3, 0.08, 0.99),
      })),
    })
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
  })

  const result = await service.search({ query: '日落', candidates, limit: 9 })
  expect(result.indexedFrameCount).toBe(3)
  expect(result.matches).toEqual([])
})

test('关键帧分析只调用视觉服务并复用逐帧描述缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const active: ActiveServices = {
    vision: serviceProfile('vision'),
    embedding: null,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl: provider.fetchImpl,
  })

  const first = await service.analyzeFrames({
    candidates,
    visionProfileId: active.vision!.id,
  })
  expect(first).toMatchObject({
    analyzedFrameCount: 3,
    newlyAnalyzedFrameCount: 3,
  })
  expect(first.frames.map((frame) => frame.resultId)).toEqual(
    candidates.map((candidate) => candidate.resultId),
  )
  expect(first.frames[0]).toMatchObject({
    assetId: 'asset-1',
    frameId: 'frame-0',
    timeSeconds: 0,
    descriptionZh: '雪山峡谷中的蓝色晨雾',
    keywordsZh: ['雪山', '晨雾', '蓝色'],
  })
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(0)

  const second = await service.analyzeFrames({
    candidates,
    visionProfileId: active.vision!.id,
  })
  expect(second.newlyAnalyzedFrameCount).toBe(0)
  expect(second.frames).toEqual(first.frames)
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(0)
  const cacheText = readFileSync(service.cachePath, 'utf8')
  expect(cacheText).toContain('"imageFingerprint"')
  expect(cacheText).toContain('"timeSeconds":0')
})

test('帧环短备注使用独立缓存并要求 AI 输出完整的 20 字内短句', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const active: ActiveServices = {
    vision: serviceProfile('vision'),
    embedding: null,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl: provider.fetchImpl,
  })

  await service.analyzeFrames({ candidates })
  const concise = await service.analyzeFrames({
    candidates,
    descriptionStyle: 'frame-note',
  })
  expect(concise.newlyAnalyzedFrameCount).toBe(3)
  expect(provider.visionIndexCalls).toBe(2)

  const visionCalls = provider.calls.filter((call) =>
    call.url.endsWith('/chat/completions'),
  )
  expect(JSON.stringify(visionCalls.at(-1)?.body.messages)).toContain(
    '不超过 20 个字符的完整中文短句',
  )

  const repeated = await service.analyzeFrames({
    candidates,
    descriptionStyle: 'frame-note',
  })
  expect(repeated.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(2)
})

test('智能整理可以中止正在进行的画面理解请求', async () => {
  const { userDataPath, candidates } = createHarness()
  const active: ActiveServices = {
    vision: serviceProfile('vision'),
    embedding: null,
  }
  let notifyStarted = () => undefined
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve
  })
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    notifyStarted()
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    })
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl,
  })
  const operationId = 'smart-organize-test'
  const analysis = service.analyzeFrames({
    operationId,
    visionProfileId: active.vision!.id,
    descriptionStyle: 'frame-note',
    candidates,
  })

  await started
  expect(service.cancelOperation(operationId)).toBe(true)
  await expect(analysis).rejects.toMatchObject({
    code: 'AI_SEARCH_CANCELLED',
  })
  expect(service.cancelOperation(operationId)).toBe(false)
})

test('项目备注优先汇总帧环文字并保守返回镜头运动', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const active: ActiveServices = {
    vision: serviceProfile('vision'),
    embedding: null,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl: provider.fetchImpl,
  })

  const summary = await service.summarizeFrameSequence({
    visionProfileId: active.vision!.id,
    frames: [
      { frameId: 'frame-0', timeSeconds: 0, note: '人物位于远景', tags: ['人物'], imagePath: candidates[0].imagePath },
      { frameId: 'frame-1', timeSeconds: 2, note: '人物进入中景', tags: ['人物'], imagePath: candidates[1].imagePath },
      { frameId: 'frame-2', timeSeconds: 4, note: '人物接近镜头', tags: ['人物'], imagePath: candidates[2].imagePath },
    ],
  })

  expect(summary).toEqual({
    note: '人物由远景逐渐接近镜头',
    tags: ['人物', '户外'],
    cameraMotion: {
      type: 'push-in',
      label: '推镜头',
      confidence: 0.88,
    },
  })
  const summaryCall = provider.calls.find((call) =>
    (call.body.response_format as { json_schema?: { name?: string } })
      ?.json_schema?.name === 'aurora_frame_sequence_summary',
  )
  expect(JSON.stringify(summaryCall?.body.messages)).toContain(
    '主体自身移动不能当作摄像机运动',
  )
  expect(JSON.stringify(summaryCall?.body.messages)).toContain('image_url')
})

test('关键帧分析缓存同时校验时间与实际图片内容', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const profile = cloudProfile()
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: provider.fetchImpl,
  })
  const candidate = candidates[0]

  const first = await service.analyzeFrames({ candidates: [candidate] })
  expect(first.newlyAnalyzedFrameCount).toBe(1)
  const searchAfterAnalysis = await service.search({
    query: '雪山',
    candidates: [candidate],
  })
  expect(searchAfterAnalysis.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(1)

  writeFileSync(candidate.imagePath, Buffer.from('replacement-frame-content'))
  const changedContent = await service.analyzeFrames({ candidates: [candidate] })
  expect(changedContent.newlyAnalyzedFrameCount).toBe(1)

  const changedTime = await service.analyzeFrames({
    candidates: [{ ...candidate, timeSeconds: 7.25 }],
  })
  expect(changedTime.newlyAnalyzedFrameCount).toBe(1)
  const repeated = await service.analyzeFrames({
    candidates: [{ ...candidate, timeSeconds: 7.25 }],
  })
  expect(repeated.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(3)
  expect(provider.embeddingCalls).toBe(2)
})

test('关键帧分析拒绝与请求不一致的 active 视觉服务', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const active: ActiveServices = {
    vision: serviceProfile('vision', { id: 'vision-after-switch' }),
    embedding: null,
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl: provider.fetchImpl,
  })

  let caught: unknown
  try {
    await service.analyzeFrames({
      candidates,
      visionProfileId: 'vision-before-switch',
    })
  } catch (error) {
    caught = error
  }
  expect(normalizeAiVisualSearchError(caught)).toMatchObject({
    code: 'AI_SEARCH_PROFILE_CHANGED',
  })
  expect(provider.calls).toHaveLength(0)
})

test('本地视觉服务使用内存联系表并长期只缓存逐帧语义结果', async () => {
  const { userDataPath, candidates } = createHarness()
  const chatBodies: Array<Record<string, unknown>> = []
  let composeCalls = 0
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/chat/completions')) {
      chatBodies.push(body)
      const count = expectedVisionFrameCount(body)
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              frames: validVisionFrames(count).reverse(),
            }),
          },
        }],
      })
    }
    const input = body.input as string[]
    return jsonResponse({
      data: input.map((_, index) => ({
        index,
        embedding: vector(3, 1, 0),
      })),
    })
  }
  const profile = cloudProfile({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
  })
  const contactSheetComposer = {
    compose: async (input: {
      frames: Array<{ imageBytes: Buffer; mimeType: string; slot: number }>
    }) => {
      composeCalls += 1
      expect(input.frames.map((frame) => frame.slot)).toEqual([0, 1, 2])
      return {
        imageBytes: Buffer.from('in-memory-contact-sheet'),
        mimeType: 'image/png' as const,
        columns: 2,
        rows: 2,
      }
    },
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
    contactSheetComposer,
  })

  const first = await service.search({ query: '任意画面', candidates })
  expect(first.newlyAnalyzedFrameCount).toBe(3)
  expect(composeCalls).toBe(1)
  expect(chatBodies).toHaveLength(1)
  expect(chatBodies[0].reasoning_effort).toBe('none')
  const messages = chatBodies[0].messages as Array<{
    content: Array<{ type: string; image_url?: { detail?: string } }>
  }>
  expect(messages[0].content.filter((item) => item.type === 'image_url')).toHaveLength(1)
  expect(messages[0].content.find((item) => item.type === 'image_url')?.image_url)
    .toMatchObject({ detail: 'high' })
  const responseFormat = chatBodies[0].response_format as {
    json_schema: {
      schema: {
        properties: {
          frames: {
            minItems: number
            maxItems: number
            items: { properties: { slot: { minimum: number; maximum: number } } }
          }
        }
      }
    }
  }
  expect(responseFormat.json_schema.schema.properties.frames).toMatchObject({
    minItems: 3,
    maxItems: 3,
  })
  expect(
    responseFormat.json_schema.schema.properties.frames.items.properties.slot,
  ).toEqual({ type: 'integer', minimum: 0, maximum: 2 })

  const second = await service.search({ query: '另一次搜索', candidates })
  expect(second.newlyAnalyzedFrameCount).toBe(0)
  expect(composeCalls).toBe(1)
  expect(chatBodies).toHaveLength(1)
  const cacheText = readFileSync(service.cachePath, 'utf8')
  expect(cacheText).not.toContain('in-memory-contact-sheet')
  expect(cacheText).not.toContain('data:image')
})

test('本地服务不接受 reasoning 控制时保留严格 Schema 后重试', async () => {
  const { userDataPath, candidates } = createHarness()
  const chatBodies: Array<Record<string, unknown>> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/chat/completions')) {
      chatBodies.push(body)
      if (body.reasoning_effort) {
        return jsonResponse({ error: { message: 'unsupported field' } }, 400)
      }
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({ frames: validVisionFrames(1) }),
          },
        }],
      })
    }
    const input = body.input as string[]
    return jsonResponse({
      data: input.map((_, index) => ({
        index,
        embedding: vector(3, 1, 0),
      })),
    })
  }
  const profile = cloudProfile({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
  })
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
  })

  const result = await service.search({
    query: '画面',
    candidates: [candidates[0]],
  })
  expect(result.newlyAnalyzedFrameCount).toBe(1)
  expect(chatBodies).toHaveLength(2)
  expect(chatBodies[0]).toMatchObject({
    reasoning_effort: 'none',
  })
  expect(chatBodies[0].response_format).toBeTruthy()
  expect(chatBodies[1].reasoning_effort).toBeUndefined()
  expect(chatBodies[1].response_format).toBeTruthy()
})

test('MiniCPM 仅返回截断 reasoning 时改用无结构输出重试', async () => {
  const { userDataPath, candidates } = createHarness()
  const chatBodies: Array<Record<string, unknown>> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/chat/completions')) {
      chatBodies.push(body)
      if (body.response_format) {
        return jsonResponse({
          choices: [{
            finish_reason: 'length',
            message: {
              content: '',
              reasoning: '内部推理耗尽了输出预算',
            },
          }],
        })
      }
      return jsonResponse({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({ frames: validVisionFrames(1) }),
          },
        }],
      })
    }
    const input = body.input as string[]
    return jsonResponse({
      data: input.map((_, index) => ({
        index,
        embedding: vector(3, 1, 0),
      })),
    })
  }
  const profile = cloudProfile({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
  })
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
  })

  const result = await service.search({
    query: '画面',
    candidates: [candidates[0]],
  })
  expect(result.newlyAnalyzedFrameCount).toBe(1)
  expect(chatBodies).toHaveLength(2)
  expect(chatBodies.every((body) => body.reasoning_effort === 'none')).toBe(true)
  expect(chatBodies[0].response_format).toBeTruthy()
  expect(chatBodies[1].response_format).toBeUndefined()
})

test('公网服务即使使用本地常见端口也保持独立多图请求', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const profile = cloudProfile({
    baseUrl: 'https://public.example:11434/v1',
  })
  let composeCalls = 0
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: provider.fetchImpl,
    contactSheetComposer: {
      compose: async () => {
        composeCalls += 1
        return {
          imageBytes: Buffer.from('unused-sheet'),
          mimeType: 'image/png' as const,
          columns: 2,
          rows: 2,
        }
      },
    },
  })

  const result = await service.search({ query: '画面', candidates })
  expect(result.newlyAnalyzedFrameCount).toBe(3)
  expect(composeCalls).toBe(0)
  const chatBody = provider.calls.find((call) =>
    call.url.endsWith('/chat/completions'),
  )?.body
  const messages = chatBody?.messages as Array<{
    content: Array<{ type: string }>
  }>
  expect(messages[0].content.filter((item) => item.type === 'image_url'))
    .toHaveLength(3)
  expect(chatBody?.reasoning_effort).toBeUndefined()
})

test('联系表返回缺失 slot 时直接降级到单帧且不会写入部分缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  const requestedCounts: number[] = []
  let composeCalls = 0
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/chat/completions')) {
      const count = expectedVisionFrameCount(body)
      requestedCounts.push(count)
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              frames: validVisionFrames(count === 1 ? 1 : 1),
            }),
          },
        }],
      })
    }
    const input = body.input as string[]
    return jsonResponse({
      data: input.map((_, index) => ({
        index,
        embedding: vector(3, 1, 0),
      })),
    })
  }
  const profile = cloudProfile({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
  })
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
    contactSheetComposer: {
      compose: async (input) => {
        composeCalls += 1
        return {
          imageBytes: Buffer.from(`sheet-${input.frames.length}`),
          mimeType: 'image/png' as const,
          columns: 2,
          rows: Math.ceil(input.frames.length / 2),
        }
      },
    },
  })

  const result = await service.search({ query: '画面', candidates })
  expect(result.newlyAnalyzedFrameCount).toBe(3)
  expect(composeCalls).toBe(1)
  expect(requestedCounts.filter((count) => count === 3)).toHaveLength(2)
  expect(requestedCounts.filter((count) => count === 2)).toHaveLength(0)
  expect(requestedCounts.filter((count) => count === 1)).toHaveLength(3)
  expect(readFileSync(service.cachePath, 'utf8')).toContain('"frameId":"frame-2"')
})

test('单帧回退仍无效时有限终止且不写入任何部分缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  let chatCalls = 0
  let embeddingCalls = 0
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).endsWith('/chat/completions')) {
      chatCalls += 1
      return jsonResponse({
        choices: [{ message: { content: '{"frames":[]}' } }],
      })
    }
    embeddingCalls += 1
    return jsonResponse({ data: [] })
  }
  const profile = cloudProfile({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: null,
  })
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
    contactSheetComposer: {
      compose: async (input) => ({
        imageBytes: Buffer.from(`sheet-${input.frames.length}`),
        mimeType: 'image/png' as const,
        columns: 2,
        rows: Math.ceil(input.frames.length / 2),
      }),
    },
  })

  let caught: unknown
  try {
    await service.search({ query: '画面', candidates })
  } catch (error) {
    caught = error
  }
  expect(normalizeAiVisualSearchError(caught)).toMatchObject({
    code: 'AI_SEARCH_BAD_RESPONSE',
  })
  expect(chatCalls).toBe(3)
  expect(embeddingCalls).toBe(0)
  expect(() => readFileSync(service.cachePath, 'utf8')).toThrow()
})

test('鉴权、限流与服务端错误不会触发拆批请求风暴', async () => {
  const cases = [
    { status: 401, code: 'AI_SEARCH_AUTH_FAILED' },
    { status: 429, code: 'AI_SEARCH_RATE_LIMITED' },
    { status: 500, code: 'AI_SEARCH_PROVIDER_ERROR' },
  ]

  for (const item of cases) {
    const { userDataPath, candidates } = createHarness()
    let chatCalls = 0
    let embeddingCalls = 0
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).endsWith('/chat/completions')) {
        chatCalls += 1
        return jsonResponse({ error: { message: 'provider failure' } }, item.status)
      }
      embeddingCalls += 1
      return jsonResponse({ data: [] })
    }
    const profile = cloudProfile({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: null,
    })
    const service = createAiVisualSearchService({
      userDataPath,
      credentialsStore: {
        readActiveProfileForMainProcess: async () => profile,
        resolveProfileInputForMainProcess: async () => profile,
      },
      fetchImpl: fetchImpl as typeof fetch,
    })

    let caught: unknown
    try {
      await service.search({ query: '画面', candidates })
    } catch (error) {
      caught = error
    }
    expect(normalizeAiVisualSearchError(caught)).toMatchObject({
      code: item.code,
      status: item.status,
    })
    expect(chatCalls).toBe(1)
    expect(embeddingCalls).toBe(0)
    expect(() => readFileSync(service.cachePath, 'utf8')).toThrow()
  }
})

test('画面理解与语义检索使用独立地址、模型与密钥', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const active: ActiveServices = {
    vision: serviceProfile('vision'),
    embedding: serviceProfile('embedding'),
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => active,
      resolveServiceProfileInputForMainProcess: async (kind) => active[kind]!,
    },
    fetchImpl: provider.fetchImpl,
  })

  const first = await service.search({
    query: '雪山',
    candidates,
    visionProfileId: active.vision!.id,
    embeddingProfileId: active.embedding!.id,
  })
  expect(first.newlyAnalyzedFrameCount).toBe(3)
  const visionCalls = provider.calls.filter((call) =>
    call.url.endsWith('/chat/completions'),
  )
  const embeddingCalls = provider.calls.filter((call) =>
    call.url.endsWith('/embeddings'),
  )
  expect(visionCalls.every((call) =>
    call.url.startsWith('https://vision.example.com/') &&
    call.authorization === 'Bearer vision-key-unit-test' &&
    call.body.model === 'split-vision-model'
  )).toBe(true)
  expect(embeddingCalls.every((call) =>
    call.url.startsWith('https://embedding.example.com/') &&
    call.authorization === 'Bearer embedding-key-unit-test' &&
    call.body.model === 'split-embedding-model'
  )).toBe(true)

  active.embedding = serviceProfile('embedding', {
    id: 'embedding-profile-two',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'four-dim-local-embedding',
    apiKey: null,
  })
  const second = await service.search({
    query: '雪山',
    candidates,
    visionProfileId: active.vision!.id,
    embeddingProfileId: active.embedding.id,
  })
  expect(second.newlyAnalyzedFrameCount).toBe(0)
  expect(provider.visionIndexCalls).toBe(1)
  expect(provider.embeddingCalls).toBe(4)
  const localCalls = provider.calls.filter((call) =>
    call.url.startsWith('http://127.0.0.1:11434/v1/embeddings'),
  )
  expect(localCalls).toHaveLength(2)
  expect(localCalls.every((call) => call.authorization === null)).toBe(true)
})

test('结构化输出不兼容时回退到纯 JSON prompt', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock({
    rejectStructuredOutput: true,
    fencedJson: true,
  })
  const profile = cloudProfile()
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: provider.fetchImpl,
  })

  const result = await service.search({
    query: '雪山',
    candidates: [candidates[0]],
  })
  const chatCalls = provider.calls.filter((call) =>
    call.url.endsWith('/chat/completions'),
  )
  expect(result.newlyAnalyzedFrameCount).toBe(1)
  expect(chatCalls).toHaveLength(2)
  expect(chatCalls[0].body.response_format).toBeTruthy()
  expect(chatCalls[1].body.response_format).toBeUndefined()
})

test('连接测试分别验证视觉与 embedding 模型且不会保存草稿', async () => {
  const { userDataPath } = createHarness()
  const provider = createCompatibleProviderMock()
  const localProfile = cloudProfile({
    id: null,
    baseUrl: 'http://localhost:9000/v1',
    apiKey: null,
    embeddingModel: 'four-dim-local-embedding',
  })
  let resolveCalls = 0
  let activeReadCalls = 0
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => {
        activeReadCalls += 1
        return null
      },
      resolveProfileInputForMainProcess: async () => {
        resolveCalls += 1
        return localProfile
      },
    },
    fetchImpl: provider.fetchImpl,
  })

  const result = await service.testProfile({ draft: true })
  expect(result).toMatchObject({
    vision: { ok: true, model: 'custom-vision-model' },
    embedding: {
      ok: true,
      model: 'four-dim-local-embedding',
      dimensions: 4,
    },
  })
  expect(resolveCalls).toBe(1)
  expect(activeReadCalls).toBe(0)
  expect(provider.connectionVisionCalls).toBe(2)
  expect(provider.embeddingCalls).toBe(1)
  expect(provider.calls.every((call) => call.authorization === null)).toBe(true)
  const visionCall = provider.calls.find((call) =>
    call.url.endsWith('/chat/completions'),
  )
  expect(JSON.stringify(visionCall?.body)).toContain('data:image/png;base64,')
})

test('独立连接测试只请求对应能力服务', async () => {
  const { userDataPath } = createHarness()
  const provider = createCompatibleProviderMock()
  const resolvedKinds: string[] = []
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveServicesForMainProcess: async () => ({
        vision: null,
        embedding: null,
      }),
      resolveServiceProfileInputForMainProcess: async (kind) => {
        resolvedKinds.push(kind)
        return serviceProfile(kind, {
          model: kind === 'embedding'
            ? 'four-dim-local-embedding'
            : 'split-vision-model',
        })
      },
    },
    fetchImpl: provider.fetchImpl,
  })

  const visionResult = await service.testVisionProfile({ draft: 'vision' })
  expect(visionResult).toMatchObject({
    ok: true,
    model: 'split-vision-model',
  })
  expect(provider.connectionVisionCalls).toBe(2)
  expect(provider.embeddingCalls).toBe(0)

  const embeddingResult = await service.testEmbeddingProfile({
    draft: 'embedding',
  })
  expect(embeddingResult).toMatchObject({
    ok: true,
    model: 'four-dim-local-embedding',
    dimensions: 4,
  })
  expect(provider.connectionVisionCalls).toBe(2)
  expect(provider.embeddingCalls).toBe(1)
  expect(resolvedKinds).toEqual(['vision', 'embedding'])
})

test('仅返回普通文本的非视觉模型不能通过连接测试', async () => {
  const { userDataPath } = createHarness()
  const profile = cloudProfile()
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).endsWith('/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: 'OK' } }] })
    }
    return jsonResponse({
      data: [
        { index: 0, embedding: vector(3, 1, 0) },
        { index: 1, embedding: vector(3, 0, 1) },
      ],
    })
  }
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: fetchImpl as typeof fetch,
  })

  let caught: unknown
  try {
    await service.testProfile({ draft: true })
  } catch (error) {
    caught = error
  }
  expect(normalizeAiVisualSearchError(caught)).toMatchObject({
    code: 'AI_SEARCH_BAD_RESPONSE',
  })
})

test('拒绝 media 目录外路径及符号链接逃逸', async () => {
  const { userDataPath, candidates } = createHarness()
  const outsideDirectory = mkdtempSync(path.join(tmpdir(), 'aurora-ai-outside-'))
  temporaryDirectories.push(outsideDirectory)
  const outsideFrame = path.join(outsideDirectory, 'outside.jpg')
  writeFileSync(outsideFrame, Buffer.from('outside'))
  const provider = createCompatibleProviderMock()
  const profile = cloudProfile()
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => profile,
      resolveProfileInputForMainProcess: async () => profile,
    },
    fetchImpl: provider.fetchImpl,
  })

  let directError: unknown
  try {
    await service.search({
      query: '雪山',
      candidates: [{ ...candidates[0], imagePath: outsideFrame }],
    })
  } catch (error) {
    directError = error
  }
  expect(normalizeAiVisualSearchError(directError)).toMatchObject({
    code: 'AI_SEARCH_FILE_NOT_ALLOWED',
  })

  const linkPath = path.join(userDataPath, 'media', 'linked-outside.jpg')
  symlinkSync(outsideFrame, linkPath)
  let symlinkError: unknown
  try {
    await service.search({
      query: '雪山',
      candidates: [{ ...candidates[0], imagePath: linkPath }],
    })
  } catch (error) {
    symlinkError = error
  }
  expect(normalizeAiVisualSearchError(symlinkError)).toMatchObject({
    code: 'AI_SEARCH_FILE_NOT_ALLOWED',
  })
  expect(provider.calls).toHaveLength(0)
})

test('未选择 active profile 时返回安全错误且不联网', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => null,
      resolveProfileInputForMainProcess: async () => cloudProfile(),
    },
    fetchImpl: provider.fetchImpl,
  })

  let caught: unknown
  try {
    await service.search({ query: '雨中奔跑', candidates })
  } catch (error) {
    caught = error
  }
  expect(normalizeAiVisualSearchError(caught)).toEqual({
    code: 'AI_SEARCH_PROFILE_NOT_CONFIGURED',
    message: '请先在探索页设置中选择一个模型服务。',
    status: null,
    retryable: false,
  })
  expect(provider.calls).toHaveLength(0)
})

test('搜索期间 active profile 发生切换时拒绝混用两套缓存', async () => {
  const { userDataPath, candidates } = createHarness()
  const provider = createCompatibleProviderMock()
  const activeProfile = cloudProfile({ id: 'profile-after-switch' })
  const service = createAiVisualSearchService({
    userDataPath,
    credentialsStore: {
      readActiveProfileForMainProcess: async () => activeProfile,
      resolveProfileInputForMainProcess: async () => activeProfile,
    },
    fetchImpl: provider.fetchImpl,
  })

  let caught: unknown
  try {
    await service.search({
      query: '雪山',
      candidates,
      profileId: 'profile-before-switch',
    })
  } catch (error) {
    caught = error
  }
  expect(normalizeAiVisualSearchError(caught)).toMatchObject({
    code: 'AI_SEARCH_PROFILE_CHANGED',
  })
  expect(provider.calls).toHaveLength(0)
})
