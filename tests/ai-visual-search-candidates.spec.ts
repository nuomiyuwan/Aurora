import { expect, test } from '@playwright/test'
import type { MediaAsset } from '../src/data/mediaLibraryTypes'
import type { Project } from '../src/data/projects'
import {
  createAiVisualSearchCandidates,
  getAiPosterTimeSeconds,
} from '../src/features/discovery/aiVisualSearchCandidates'

const project: Project = {
  id: 'project-1',
  kind: 'video',
  title: '时差',
  subtitle: '',
  cover: '',
  videoCount: 1,
  collectionCount: 0,
  updatedAt: '',
}

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'asset-1',
  filename: 'sunset.mp4',
  thumbnail: '/managed/media/asset-1/thumbnail/v1/sunset.jpg',
  duration: '00:21',
  resolution: '3840 x 2160',
  fps: '59.94 fps',
  frameCount: '1200',
  sampleCount: 0,
  size: '200 MB',
  codec: 'HEVC',
  camera: '未写入',
  capturedAt: '',
  sourceFingerprint: 'source-v1',
  sourcePath: '/Volumes/NAS/sunset.mp4',
  favorite: false,
  indexTask: 'idle',
  durationSeconds: 21,
  width: 3840,
  height: 2160,
  fpsValue: 59.94,
  sizeBytes: 200_000_000,
  indexError: null,
  ...overrides,
})

const clip = (indexedFrames: Array<{
  id: string
  imagePath?: string
  timeSeconds: number
}> = []) => ({
  id: 'clip-1',
  assetId: 'asset-1',
  projectId: 'project-1',
  filename: 'sunset.mp4',
  sourceFingerprint: 'source-v1',
  durationSeconds: 21,
  tags: [],
  note: '',
  indexedFrames,
})

test('未建立视觉索引时把现成的本地缩略图作为 AI poster 候选', () => {
  const candidates = createAiVisualSearchCandidates({
    clips: [clip()],
    assets: [asset()],
    projects: [project],
  })

  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({
    resultId: 'local:poster:clip-1',
    frameId: 'asset-poster-v1',
    analysisTier: 'thumbnail',
    imagePath: '/managed/media/asset-1/thumbnail/v1/sunset.jpg',
    timeSeconds: 2.1,
  })
})

test('已有完整视觉索引时只使用关键帧，不重复加入 poster', () => {
  const candidates = createAiVisualSearchCandidates({
    clips: [clip([
      { id: 'frame-1', imagePath: '/managed/frame-1.jpg', timeSeconds: 3 },
      { id: 'frame-2', imagePath: '/managed/frame-2.jpg', timeSeconds: 8 },
    ])],
    assets: [asset()],
    projects: [project],
  })

  expect(candidates.map((candidate) => candidate.resultId)).toEqual([
    'local:frame:clip-1:frame-1',
    'local:frame:clip-1:frame-2',
  ])
  expect(candidates.map((candidate) => candidate.analysisTier)).toEqual([
    'visual-index',
    'visual-index',
  ])
})

test('同一素材被多个项目引用时只加入一次并优先完整视觉索引', () => {
  const candidates = createAiVisualSearchCandidates({
    clips: [
      clip(),
      {
        ...clip([
          { id: 'frame-1', imagePath: '/managed/frame-1.jpg', timeSeconds: 3 },
        ]),
        id: 'clip-2',
      },
    ],
    assets: [asset()],
    projects: [project],
  })

  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({
    resultId: 'local:frame:clip-2:frame-1',
    assetId: 'asset-1',
    analysisTier: 'visual-index',
  })
})

test('不把远程或内置相对缩略图发送给本地 AI 画面桥', () => {
  for (const thumbnail of ['https://example.com/poster.jpg', './aurora/demo.png']) {
    expect(createAiVisualSearchCandidates({
      clips: [clip()],
      assets: [asset({ thumbnail })],
      projects: [project],
    })).toEqual([])
  }
})

test('poster 时间与导入缩略图采样规则一致', () => {
  expect(getAiPosterTimeSeconds(null)).toBe(0)
  expect(getAiPosterTimeSeconds(2)).toBeCloseTo(0.5)
  expect(getAiPosterTimeSeconds(100)).toBe(5)
})
