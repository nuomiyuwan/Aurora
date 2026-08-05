import { expect, test } from '@playwright/test'
import type { DiscoveryFootageResult } from '../src/features/discovery/discoveryData'
import {
  findStrongLocalMetadataMatches,
  runHybridDiscoverySearch,
} from '../src/features/discovery/search/hybridDiscoverySearch'

function makeFootageResult(
  id: string,
  filename: string,
  overrides: Partial<DiscoveryFootageResult> = {},
): DiscoveryFootageResult {
  return {
    id,
    title: filename.replace(/\.[^.]+$/, ''),
    secondaryLabel: filename,
    sourceCollection: '测试项目',
    thumbnail: `aurora-media://thumbnail/${id}`,
    timecode: '00:00:00:00',
    duration: '00:00:12:00',
    resolution: '3840 × 2160',
    resolutionLabel: '4K',
    source: 'local',
    detailType: 'footage',
    kind: 'clip',
    description: '',
    tags: [],
    previewProgress: 0,
    footage: {
      filename,
      project: '测试项目',
      auroraProjectId: 'project-one',
      auroraClipId: id,
      codec: 'Apple ProRes',
      fps: '24 fps',
      size: '1 GB',
      camera: '未写入',
      capturedAt: '2026-08-03 10:00',
      sourcePath: `/Volumes/Aurora/${filename}`,
    },
    visualIndex: {
      status: 'ready',
      keyframeCount: 1,
      highlightCount: 0,
      favoriteCount: 0,
    },
    ...overrides,
  }
}

test('文件全名或不带扩展名的 stem 精确命中本地元数据', () => {
  const exact = makeFootageResult('exact', 'A001_C012.MOV', {
    title: '冰川远景',
    secondaryLabel: '本地索引素材',
  })
  const similar = makeFootageResult('similar', 'A001_C012_ALT.MOV')
  const results = [exact, similar]

  expect(
    findStrongLocalMetadataMatches(results, {
      query: 'a001_c012.mov',
      kind: 'all',
      resolution: 'all',
      limit: 18,
    }).map((result) => result.id),
  ).toEqual(['exact'])

  expect(
    findStrongLocalMetadataMatches(results, {
      query: 'A001_C012',
      kind: 'clip',
      resolution: '4K',
      limit: 18,
    }).map((result) => result.id),
  ).toEqual(['exact'])
})

test('AI 模式的明确文件名搜索直接返回本地结果，不启动常规或 AI 搜索', async () => {
  const exact = makeFootageResult('exact', 'A001_C012.MOV')
  let localCalls = 0
  let aiCalls = 0

  const response = await runHybridDiscoverySearch({
    strongLocalResults: [exact],
    runLocalSearch: async () => {
      localCalls += 1
      return []
    },
    runAiSearch: async () => {
      aiCalls += 1
      return []
    },
    limit: 18,
  })

  expect(response).toEqual({ results: [exact], aiError: null })
  expect(localCalls).toBe(0)
  expect(aiCalls).toBe(0)
})

test('自然语言搜索同时查询本地与 AI，本地结果在前并按 ID 去重', async () => {
  const local = makeFootageResult('local-only', 'LOCAL_001.MOV')
  const duplicateFromLocal = makeFootageResult('shared', 'SHARED.MOV', {
    description: '本地备注',
  })
  const duplicateFromAi = makeFootageResult('shared', 'SHARED.MOV', {
    description: 'AI 画面描述',
  })
  const ai = makeFootageResult('ai-only', 'AI_001.MOV')
  let localCalls = 0
  let aiCalls = 0

  const response = await runHybridDiscoverySearch({
    strongLocalResults: [],
    runLocalSearch: async () => {
      localCalls += 1
      return [local, duplicateFromLocal]
    },
    runAiSearch: async () => {
      aiCalls += 1
      return [duplicateFromAi, ai]
    },
    limit: 18,
  })

  expect(localCalls).toBe(1)
  expect(aiCalls).toBe(1)
  expect(response.aiError).toBeNull()
  expect(response.results.map((result) => result.id)).toEqual([
    'local-only',
    'shared',
    'ai-only',
  ])
  expect(response.results[1].description).toBe('本地备注')
})

test('本地搜索失败时 AI 结果仍正常返回', async () => {
  const ai = makeFootageResult('ai-only', 'AI_001.MOV')
  let aiCalls = 0

  const response = await runHybridDiscoverySearch({
    strongLocalResults: [],
    runLocalSearch: async () => {
      throw new Error('本地索引暂时不可用')
    },
    runAiSearch: async () => {
      aiCalls += 1
      return [ai]
    },
    limit: 18,
  })

  expect(aiCalls).toBe(1)
  expect(response).toEqual({ results: [ai], aiError: null })
})

test('本地搜索无结果时不会短路 AI 搜索', async () => {
  const ai = makeFootageResult('ai-only', 'AI_001.MOV')
  let aiCalls = 0

  const response = await runHybridDiscoverySearch({
    strongLocalResults: [],
    runLocalSearch: async () => [],
    runAiSearch: async () => {
      aiCalls += 1
      return [ai]
    },
    limit: 18,
  })

  expect(aiCalls).toBe(1)
  expect(response).toEqual({ results: [ai], aiError: null })
})

test('AI 搜索失败时保留已完成的本地结果并返回错误', async () => {
  const local = makeFootageResult('local-only', 'LOCAL_001.MOV')

  const response = await runHybridDiscoverySearch({
    strongLocalResults: [],
    runLocalSearch: async () => [local],
    runAiSearch: async () => {
      throw new Error('AI 服务超时')
    },
    limit: 18,
  })

  expect(response.results).toEqual([local])
  expect(response.aiError).toEqual(new Error('AI 服务超时'))
})
