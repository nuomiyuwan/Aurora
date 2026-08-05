import { expect, test } from '@playwright/test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  AI_SERVICE_KINDS,
  createAiCredentialsStore,
  normalizeAiCredentialError,
  normalizeProviderBaseUrl,
} = require('../electron/aiCredentials.cjs') as {
  AI_SERVICE_KINDS: {
    VISION: 'vision'
    EMBEDDING: 'embedding'
  }
  createAiCredentialsStore(options: {
    filePath: string
    safeStorage: SafeStorageStub
  }): AiCredentialsStore
  normalizeAiCredentialError(error: unknown): {
    code: string
    message: string
  }
  normalizeProviderBaseUrl(value: unknown): string
}

type SafeStorageStub = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

type ProfileInput = {
  id?: string
  name: string
  baseUrl: string
  visionModel: string
  embeddingModel: string
  apiKey?: string
  clearApiKey?: boolean
}

type ServiceKind = 'vision' | 'embedding'

type ServiceProfileInput = {
  id?: string
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
}

type PublicServiceProfile = Omit<
  ServiceProfileInput,
  'apiKey' | 'clearApiKey'
> & {
  id: string
  hasApiKey: boolean
}

type ServiceProfilesState = {
  visionProfiles: PublicServiceProfile[]
  embeddingProfiles: PublicServiceProfile[]
  activeVisionProfileId: string | null
  activeEmbeddingProfileId: string | null
  secureStorageAvailable: boolean
}

type PublicProfile = Omit<ProfileInput, 'apiKey' | 'clearApiKey'> & {
  id: string
  hasApiKey: boolean
}

type ProfilesState = {
  profiles: PublicProfile[]
  activeProfileId: string | null
  secureStorageAvailable: boolean
}

type AiCredentialsStore = {
  getServiceProfiles(): Promise<ServiceProfilesState>
  saveServiceProfile(
    kind: ServiceKind,
    input: ServiceProfileInput,
  ): Promise<{
    profile: PublicServiceProfile
    state: ServiceProfilesState
  }>
  selectServiceProfile(
    kind: ServiceKind,
    id: string | null,
  ): Promise<ServiceProfilesState>
  deleteServiceProfile(
    kind: ServiceKind,
    id: string,
  ): Promise<ServiceProfilesState>
  readActiveServicesForMainProcess(): Promise<{
    vision:
      | (Omit<PublicServiceProfile, 'hasApiKey'> & { apiKey: string | null })
      | null
    embedding:
      | (Omit<PublicServiceProfile, 'hasApiKey'> & { apiKey: string | null })
      | null
  }>
  resolveServiceProfileInputForMainProcess(
    kind: ServiceKind,
    input: ServiceProfileInput,
  ): Promise<
    Omit<PublicServiceProfile, 'hasApiKey'> & {
      id: string | null
      apiKey: string | null
    }
  >
  getProfiles(): Promise<ProfilesState>
  saveProfile(input: ProfileInput): Promise<{
    profile: PublicProfile
    state: ProfilesState
  }>
  selectProfile(id: string | null): Promise<ProfilesState>
  deleteProfile(id: string): Promise<ProfilesState>
  readActiveProfileForMainProcess(): Promise<
    | (Omit<PublicProfile, 'hasApiKey'> & { apiKey: string | null })
    | null
  >
  resolveProfileInputForMainProcess(input: ProfileInput): Promise<
    Omit<PublicProfile, 'hasApiKey'> & { id: string | null; apiKey: string | null }
  >
}

const temporaryDirectories: string[] = []

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createHarness(encryptionAvailable = true) {
  const directory = mkdtempSync(path.join(tmpdir(), 'aurora-ai-profiles-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'ai-credentials.json')
  const mask = Buffer.from('aurora-safe-storage')
  const transform = (input: Buffer) =>
    Buffer.from(input.map((byte, index) => byte ^ mask[index % mask.length]))
  const safeStorage: SafeStorageStub = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value) => transform(Buffer.from(value, 'utf8')),
    decryptString: (value) => transform(value).toString('utf8'),
  }

  return {
    filePath,
    safeStorage,
    store: createAiCredentialsStore({ filePath, safeStorage }),
  }
}

function cloudProfile(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    name: '主视觉模型',
    baseUrl: 'https://models.example.com/v1/',
    visionModel: 'vision-model-a',
    embeddingModel: 'embedding-model-a',
    ...overrides,
  }
}

test('画面理解与语义检索可独立保存、选择并读取各自密钥', async () => {
  const { filePath, store } = createHarness()
  const visionSecret = 'vision-provider-secret'
  const embeddingSecret = 'embedding-provider-secret'

  const vision = await store.saveServiceProfile(AI_SERVICE_KINDS.VISION, {
    name: '在线画面理解',
    baseUrl: 'https://vision.example.com/v1/chat/completions',
    model: 'vision-model-pro',
    apiKey: visionSecret,
  })
  const embedding = await store.saveServiceProfile(
    AI_SERVICE_KINDS.EMBEDDING,
    {
      name: '本地语义检索',
      baseUrl: 'http://127.0.0.1:11434/v1/embeddings',
      model: 'qwen3-embedding:0.6b',
      apiKey: embeddingSecret,
    },
  )

  expect(vision.profile).toEqual({
    id: expect.stringMatching(/^vision-/),
    name: '在线画面理解',
    baseUrl: 'https://vision.example.com/v1',
    model: 'vision-model-pro',
    hasApiKey: true,
  })
  expect(embedding.profile).toEqual({
    id: expect.stringMatching(/^embedding-/),
    name: '本地语义检索',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3-embedding:0.6b',
    hasApiKey: true,
  })
  expect(embedding.state).toMatchObject({
    activeVisionProfileId: vision.profile.id,
    activeEmbeddingProfileId: embedding.profile.id,
  })
  expect(JSON.stringify(embedding.state)).not.toContain(visionSecret)
  expect(JSON.stringify(embedding.state)).not.toContain(embeddingSecret)

  expect(await store.readActiveServicesForMainProcess()).toEqual({
    vision: {
      id: vision.profile.id,
      name: '在线画面理解',
      baseUrl: 'https://vision.example.com/v1',
      model: 'vision-model-pro',
      apiKey: visionSecret,
    },
    embedding: {
      id: embedding.profile.id,
      name: '本地语义检索',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen3-embedding:0.6b',
      apiKey: embeddingSecret,
    },
  })

  const storedText = readFileSync(filePath, 'utf8')
  expect(storedText).not.toContain(visionSecret)
  expect(storedText).not.toContain(embeddingSecret)
  expect(JSON.parse(storedText)).toMatchObject({
    version: 3,
    activeVisionProfileId: vision.profile.id,
    activeEmbeddingProfileId: embedding.profile.id,
    visionProfiles: [
      {
        id: vision.profile.id,
        model: 'vision-model-pro',
        encryptedApiKey: expect.any(String),
      },
    ],
    embeddingProfiles: [
      {
        id: embedding.profile.id,
        model: 'qwen3-embedding:0.6b',
        encryptedApiKey: expect.any(String),
      },
    ],
  })
  expect(statSync(filePath).mode & 0o777).toBe(0o600)
})

test('重建凭据存储实例后仍恢复两类配置、当前选择与加密 Key', async () => {
  const { filePath, safeStorage, store } = createHarness()
  const vision = await store.saveServiceProfile('vision', {
    name: '持久视觉',
    baseUrl: 'https://vision.example.com/v1',
    model: 'vision-persisted',
    apiKey: 'vision-persisted-key',
  })
  const embedding = await store.saveServiceProfile('embedding', {
    name: '持久语义',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'embedding-persisted',
  })

  const restarted = createAiCredentialsStore({ filePath, safeStorage })

  expect(await restarted.getServiceProfiles()).toMatchObject({
    activeVisionProfileId: vision.profile.id,
    activeEmbeddingProfileId: embedding.profile.id,
    visionProfiles: [{ id: vision.profile.id, model: 'vision-persisted' }],
    embeddingProfiles: [
      { id: embedding.profile.id, model: 'embedding-persisted' },
    ],
  })
  expect(await restarted.readActiveServicesForMainProcess()).toMatchObject({
    vision: { id: vision.profile.id, apiKey: 'vision-persisted-key' },
    embedding: { id: embedding.profile.id, apiKey: null },
  })
})

test('每类服务只能在完全相同的 baseUrl 下沿用密钥', async () => {
  const { store } = createHarness()
  const saved = await store.saveServiceProfile('vision', {
    name: '视觉服务',
    baseUrl: 'https://provider.example.com/v1',
    model: 'vision-a',
    apiKey: 'vision-key',
  })

  const sameProviderDraft = await store.resolveServiceProfileInputForMainProcess(
    'vision',
    {
      id: saved.profile.id,
      name: '视觉服务',
      baseUrl: 'https://provider.example.com/v1/',
      model: 'vision-b',
    },
  )
  expect(sameProviderDraft.apiKey).toBe('vision-key')

  const movedDraft = await store.resolveServiceProfileInputForMainProcess(
    'vision',
    {
      id: saved.profile.id,
      name: '视觉服务',
      baseUrl: 'https://provider.example.com/other/v1',
      model: 'vision-b',
    },
  )
  expect(movedDraft.apiKey).toBeNull()

  const moved = await store.saveServiceProfile('vision', {
    id: saved.profile.id,
    name: '视觉服务',
    baseUrl: 'https://provider.example.com/other/v1',
    model: 'vision-b',
  })
  expect(moved.profile.hasApiKey).toBe(false)
  expect((await store.readActiveServicesForMainProcess()).vision?.apiKey).toBeNull()
})

test('两类服务可分别清除、取消选择和删除且互不影响', async () => {
  const { store } = createHarness()
  const vision = await store.saveServiceProfile('vision', {
    name: '视觉',
    baseUrl: 'https://vision.example.com/v1',
    model: 'vision-a',
    apiKey: 'vision-secret',
  })
  const embedding = await store.saveServiceProfile('embedding', {
    name: '语义',
    baseUrl: 'https://embedding.example.com/v1',
    model: 'embedding-a',
    apiKey: 'embedding-secret',
  })

  await store.saveServiceProfile('vision', {
    id: vision.profile.id,
    name: '视觉',
    baseUrl: 'https://vision.example.com/v1',
    model: 'vision-a',
    clearApiKey: true,
  })
  let active = await store.readActiveServicesForMainProcess()
  expect(active.vision?.apiKey).toBeNull()
  expect(active.embedding?.apiKey).toBe('embedding-secret')

  const unselected = await store.selectServiceProfile('vision', null)
  expect(unselected.activeVisionProfileId).toBeNull()
  expect(unselected.activeEmbeddingProfileId).toBe(embedding.profile.id)

  const deleted = await store.deleteServiceProfile(
    'embedding',
    embedding.profile.id,
  )
  expect(deleted.embeddingProfiles).toEqual([])
  expect(deleted.visionProfiles).toHaveLength(1)
  active = await store.readActiveServicesForMainProcess()
  expect(active).toEqual({ vision: null, embedding: null })
})

test('多个 profile 只公开安全字段，空 Key 仅在同一服务地址沿用旧密钥', async () => {
  const { filePath, store } = createHarness()
  const secret = 'provider-secret-for-unit-test'
  const saved = await store.saveProfile(cloudProfile({ apiKey: secret }))

  expect(saved.profile).toEqual({
    id: expect.stringMatching(/^provider-/),
    name: '主视觉模型',
    baseUrl: 'https://models.example.com/v1',
    visionModel: 'vision-model-a',
    embeddingModel: 'embedding-model-a',
    hasApiKey: true,
  })
  expect(saved.state.activeProfileId).toBe(saved.profile.id)
  expect(JSON.stringify(saved)).not.toContain(secret)

  const storedText = readFileSync(filePath, 'utf8')
  expect(storedText).not.toContain(secret)
  expect(JSON.parse(storedText)).toMatchObject({
    version: 3,
    activeVisionProfileId: saved.profile.id,
    activeEmbeddingProfileId: saved.profile.id,
    visionProfiles: [{ encryptedApiKey: expect.any(String) }],
    embeddingProfiles: [{ encryptedApiKey: expect.any(String) }],
  })
  expect(statSync(filePath).mode & 0o777).toBe(0o600)

  const updated = await store.saveProfile(
    cloudProfile({
      id: saved.profile.id,
      visionModel: 'vision-model-b',
      apiKey: '   ',
    }),
  )
  expect(updated.profile.id).toBe(saved.profile.id)
  expect(updated.profile.visionModel).toBe('vision-model-b')
  expect(updated.profile.hasApiKey).toBe(true)

  await store.selectProfile(saved.profile.id)
  expect(await store.readActiveProfileForMainProcess()).toMatchObject({
    id: saved.profile.id,
    visionModel: 'vision-model-b',
    apiKey: secret,
  })

  const movedInput = cloudProfile({
    id: saved.profile.id,
    baseUrl: 'https://another-provider.example/v1',
    visionModel: 'vision-model-b',
  })
  expect(
    (await store.resolveProfileInputForMainProcess(movedInput)).apiKey,
  ).toBeNull()
  const moved = await store.saveProfile(movedInput)
  expect(moved.profile.hasApiKey).toBe(false)

  const local = await store.saveProfile({
    name: '本机模型',
    baseUrl: 'http://127.0.0.1:1234/v1',
    visionModel: 'local-vision',
    embeddingModel: 'local-embed',
  })
  expect(local.profile.hasApiKey).toBe(false)
  await store.selectProfile(local.profile.id)
  expect(await store.readActiveProfileForMainProcess()).toMatchObject({
    id: local.profile.id,
    apiKey: null,
  })
})

test('明确清除、选择与删除 profile 不会暴露其他密钥', async () => {
  const { store } = createHarness()
  const first = await store.saveProfile(cloudProfile({ apiKey: 'first-secret' }))
  const second = await store.saveProfile(
    cloudProfile({
      name: '备用模型',
      baseUrl: 'https://backup.example.com/openai/v1',
      visionModel: 'vision-two',
      embeddingModel: 'embed-two',
      apiKey: 'second-secret',
    }),
  )

  await store.selectProfile(first.profile.id)
  const cleared = await store.saveProfile(
    cloudProfile({ id: first.profile.id, clearApiKey: true }),
  )
  expect(cleared.profile.hasApiKey).toBe(false)
  expect((await store.readActiveProfileForMainProcess())?.apiKey).toBeNull()

  const remaining = await store.deleteProfile(first.profile.id)
  expect(remaining.activeProfileId).toBeNull()
  expect(remaining.profiles.map((profile) => profile.id)).toEqual([
    second.profile.id,
  ])
  expect(JSON.stringify(remaining)).not.toContain('second-secret')
})

test('无安全存储时仍可保存本地无密钥服务，但拒绝明文降级', async () => {
  const { filePath, store } = createHarness(false)
  const keyless = await store.saveProfile({
    name: '本机兼容服务',
    baseUrl: 'http://localhost:8080/v1',
    visionModel: 'vision-local',
    embeddingModel: 'embed-local',
  })
  expect(keyless.state.secureStorageAvailable).toBe(false)
  expect(keyless.profile.hasApiKey).toBe(false)

  let caught: unknown
  try {
    await store.saveProfile(
      cloudProfile({ name: '不能明文保存', apiKey: 'never-write-plaintext' }),
    )
  } catch (error) {
    caught = error
  }
  expect(normalizeAiCredentialError(caught)).toEqual({
    code: 'AI_PROVIDER_ENCRYPTION_UNAVAILABLE',
    message: '当前系统无法安全保存 API Key；可以留空连接本地无密钥服务。',
  })
  expect(readFileSync(filePath, 'utf8')).not.toContain('never-write-plaintext')
})

test('外网仅允许 HTTPS，本机回环地址可以使用 HTTP', () => {
  expect(normalizeProviderBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
    'https://api.example.com/v1',
  )
  expect(normalizeProviderBaseUrl('http://localhost:11434/v1/')).toBe(
    'http://localhost:11434/v1',
  )
  expect(normalizeProviderBaseUrl('http://127.0.0.2:8080/v1')).toBe(
    'http://127.0.0.2:8080/v1',
  )
  expect(() => normalizeProviderBaseUrl('http://api.example.com/v1')).toThrow()
  expect(() => normalizeProviderBaseUrl('http://192.168.1.20:8080/v1')).toThrow()
  expect(() => normalizeProviderBaseUrl('file:///tmp/model')).toThrow()
})

test('损坏或未知版本的凭据文件会阻止覆盖并保留原内容', async () => {
  const { filePath, store } = createHarness()
  const corrupted = '{"version":2,"profiles":['
  writeFileSync(filePath, corrupted, { encoding: 'utf8', mode: 0o600 })

  let readError: unknown
  try {
    await store.getProfiles()
  } catch (error) {
    readError = error
  }
  expect(normalizeAiCredentialError(readError)).toMatchObject({
    code: 'AI_PROVIDER_STORAGE_ERROR',
  })

  let saveError: unknown
  try {
    await store.saveProfile(cloudProfile({ apiKey: 'must-not-overwrite' }))
  } catch (error) {
    saveError = error
  }
  expect(normalizeAiCredentialError(saveError)).toMatchObject({
    code: 'AI_PROVIDER_STORAGE_ERROR',
  })
  expect(readFileSync(filePath, 'utf8')).toBe(corrupted)
})

test('v2 单 profile 会兼容读取为两套独立服务并在下次写入时迁移', async () => {
  const { filePath, safeStorage, store } = createHarness()
  const oldSecret = 'v2-shared-secret'
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 2,
      activeProfileId: 'provider-old',
      profiles: [
        {
          id: 'provider-old',
          name: '旧版组合服务',
          baseUrl: 'https://legacy.example.com/v1',
          visionModel: 'legacy-vision',
          embeddingModel: 'legacy-embedding',
          encryptedApiKey: safeStorage.encryptString(oldSecret).toString('base64'),
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    }),
    { encoding: 'utf8', mode: 0o600 },
  )

  expect(await store.getServiceProfiles()).toEqual({
    visionProfiles: [
      {
        id: 'provider-old',
        name: '旧版组合服务',
        baseUrl: 'https://legacy.example.com/v1',
        model: 'legacy-vision',
        hasApiKey: true,
      },
    ],
    embeddingProfiles: [
      {
        id: 'provider-old',
        name: '旧版组合服务',
        baseUrl: 'https://legacy.example.com/v1',
        model: 'legacy-embedding',
        hasApiKey: true,
      },
    ],
    activeVisionProfileId: 'provider-old',
    activeEmbeddingProfileId: 'provider-old',
    secureStorageAvailable: true,
  })
  expect(await store.readActiveServicesForMainProcess()).toMatchObject({
    vision: { model: 'legacy-vision', apiKey: oldSecret },
    embedding: { model: 'legacy-embedding', apiKey: oldSecret },
  })
  expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(2)

  await store.saveServiceProfile('embedding', {
    id: 'provider-old',
    name: '本地语义服务',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3-embedding:0.6b',
  })
  const active = await store.readActiveServicesForMainProcess()
  expect(active.vision?.apiKey).toBe(oldSecret)
  expect(active.embedding?.apiKey).toBeNull()
  expect(active.embedding?.baseUrl).toBe('http://localhost:11434/v1')

  const migrated = JSON.parse(readFileSync(filePath, 'utf8'))
  expect(migrated).toMatchObject({
    version: 3,
    activeVisionProfileId: 'provider-old',
    activeEmbeddingProfileId: 'provider-old',
  })
  expect(migrated.profiles).toBeUndefined()
  expect(migrated.visionProfiles).toHaveLength(1)
  expect(migrated.embeddingProfiles).toHaveLength(1)
})

test('v1 OpenAI 密钥可分别迁移给两类服务且不会被其他地址领取', async () => {
  const { filePath, safeStorage, store } = createHarness()
  const legacySecret = 'v1-openai-secret'
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      provider: 'openai',
      encryptedApiKey: safeStorage.encryptString(legacySecret).toString('base64'),
    }),
    { encoding: 'utf8', mode: 0o600 },
  )

  const unrelated = await store.resolveServiceProfileInputForMainProcess(
    'vision',
    {
      name: '其他路径',
      baseUrl: 'https://api.openai.com/custom/v1',
      model: 'vision-model',
    },
  )
  expect(unrelated.apiKey).toBeNull()

  const vision = await store.saveServiceProfile('vision', {
    name: 'OpenAI 视觉',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  })
  expect(vision.profile.hasApiKey).toBe(true)
  let stored = JSON.parse(readFileSync(filePath, 'utf8'))
  expect(stored.legacyKeyPendingKinds).toEqual(['embedding'])
  expect(stored.legacyEncryptedApiKey).toEqual(expect.any(String))

  const embeddingDraft = await store.resolveServiceProfileInputForMainProcess(
    'embedding',
    {
      name: 'OpenAI Embedding',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
    },
  )
  expect(embeddingDraft.apiKey).toBe(legacySecret)
  const embedding = await store.saveServiceProfile('embedding', {
    name: 'OpenAI Embedding',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  })
  expect(embedding.profile.hasApiKey).toBe(true)

  stored = JSON.parse(readFileSync(filePath, 'utf8'))
  expect(stored.legacyEncryptedApiKey).toBeUndefined()
  expect(stored.legacyKeyPendingKinds).toBeUndefined()
  expect(await store.readActiveServicesForMainProcess()).toMatchObject({
    vision: { apiKey: legacySecret },
    embedding: { apiKey: legacySecret },
  })
})

test('旧版单 Key 可在首次保存 profile 时无损迁移，测试草稿不会落盘', async () => {
  const { filePath, safeStorage, store } = createHarness()
  const legacySecret = 'legacy-openai-key'
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      provider: 'openai',
      encryptedApiKey: safeStorage.encryptString(legacySecret).toString('base64'),
    }),
    { encoding: 'utf8', mode: 0o600 },
  )

  expect(await store.getProfiles()).toEqual({
    profiles: [],
    activeProfileId: null,
    secureStorageAvailable: true,
  })
  const unrelatedDraft = await store.resolveProfileInputForMainProcess(
    cloudProfile(),
  )
  expect(unrelatedDraft.apiKey).toBeNull()
  const openAiProfile = cloudProfile({
    name: '旧版 OpenAI 配置',
    baseUrl: 'https://api.openai.com/v1',
    visionModel: 'gpt-4.1-mini',
    embeddingModel: 'text-embedding-3-small',
  })
  const resolvedDraft = await store.resolveProfileInputForMainProcess(
    openAiProfile,
  )
  expect(resolvedDraft.apiKey).toBe(legacySecret)
  expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1)

  const unrelatedSaved = await store.saveProfile(cloudProfile())
  expect(unrelatedSaved.profile.hasApiKey).toBe(false)
  expect(
    (await store.resolveProfileInputForMainProcess(openAiProfile)).apiKey,
  ).toBe(legacySecret)

  const migrated = await store.saveProfile(openAiProfile)
  expect(migrated.profile.hasApiKey).toBe(true)
  await store.selectProfile(migrated.profile.id)
  expect((await store.readActiveProfileForMainProcess())?.apiKey).toBe(
    legacySecret,
  )
  expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(3)
})
