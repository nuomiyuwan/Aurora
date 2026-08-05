import { expect, test } from '@playwright/test'
import {
  DEFAULT_CLIP_FILTER_STATE,
  filterAndSortVideoClips,
  formatClipResolutionKey,
  getClipCapturedAtSortValue,
  getClipResolutionKey,
  getClipResolutionOptions,
  getClipTagOptions,
  hasClipVisualIndex,
  isClipFilterStateActive,
  type FilterableVideoClip,
} from '../src/features/video-library/clipFiltering'

interface TestClip extends FilterableVideoClip {
  id: string
}

function makeClip(
  id: string,
  overrides: Partial<TestClip> = {},
): TestClip {
  return {
    id,
    order: 0,
    filename: `${id}.mov`,
    tags: [],
    codec: 'ProRes 4444',
    resolution: '1920 x 1080',
    width: 1920,
    height: 1080,
    durationSeconds: 90,
    capturedAt: '2024-05-12 14:35',
    favorite: false,
    sampleCount: 0,
    indexedFrames: [],
    ...overrides,
  }
}

test('分辨率优先使用真实宽高，缺失时才解析展示字符串', () => {
  expect(
    getClipResolutionKey(
      makeClip('numeric', {
        width: 3840,
        height: 2160,
        resolution: '1920 x 1080',
      }),
    ),
  ).toBe('3840x2160')
  expect(
    getClipResolutionKey(
      makeClip('fallback', {
        width: null,
        height: null,
        resolution: '2560 × 1440',
      }),
    ),
  ).toBe('2560x1440')
  expect(
    getClipResolutionKey(
      makeClip('unknown', {
        width: null,
        height: null,
        resolution: '待分析',
      }),
    ),
  ).toBe('unknown')
  expect(formatClipResolutionKey('3840x2160')).toBe('3840 × 2160')
  expect(formatClipResolutionKey('unknown')).toBe('待分析')
})

test('状态筛选区分收藏、已建立索引与未建立索引', () => {
  const clips = [
    makeClip('plain'),
    makeClip('favorite', { favorite: true }),
    makeClip('sampled', { sampleCount: 12 }),
    makeClip('frames', { indexedFrames: [{ time: 0 }] }),
  ]

  expect(
    filterAndSortVideoClips(clips, { status: 'favorite' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['favorite'])
  expect(
    filterAndSortVideoClips(clips, { status: 'indexed' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['sampled', 'frames'])
  expect(
    filterAndSortVideoClips(clips, { status: 'unindexed' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['plain', 'favorite'])
  expect(hasClipVisualIndex(makeClip('explicit', { hasVisualIndex: true }))).toBe(
    true,
  )
  expect(
    hasClipVisualIndex(
      makeClip('explicit-false', {
        hasVisualIndex: false,
        sampleCount: 12,
      }),
    ),
  ).toBe(false)
})

test('时长筛选覆盖精确边界和待分析素材', () => {
  const clips = [
    makeClip('under', { durationSeconds: 59.999 }),
    makeClip('one-minute', { durationSeconds: 60 }),
    makeClip('five-minutes', { durationSeconds: 300 }),
    makeClip('twenty-minutes', { durationSeconds: 1200 }),
    makeClip('unknown-null', { durationSeconds: null }),
    makeClip('unknown-zero', { durationSeconds: 0 }),
  ]

  expect(
    filterAndSortVideoClips(clips, { duration: 'under60' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['under'])
  expect(
    filterAndSortVideoClips(clips, { duration: '60to300' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['one-minute'])
  expect(
    filterAndSortVideoClips(clips, { duration: '300to1200' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['five-minutes'])
  expect(
    filterAndSortVideoClips(clips, { duration: 'over1200' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['twenty-minutes'])
  expect(
    filterAndSortVideoClips(clips, { duration: 'unknown' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['unknown-null', 'unknown-zero'])
})

test('搜索覆盖文件名、标签、编码与分辨率，并与其他维度执行 AND', () => {
  const clips = [
    makeClip('target', {
      filename: 'A001_C012.mov',
      tags: ['逆光', '人物'],
      codec: 'HEVC',
      width: 3840,
      height: 2160,
      resolution: '3840 x 2160',
      favorite: true,
    }),
    makeClip('wrong-status', {
      filename: 'A001_C013.mov',
      tags: ['逆光'],
      codec: 'HEVC',
      width: 3840,
      height: 2160,
    }),
    makeClip('wrong-resolution', {
      filename: 'A001_C014.mov',
      tags: ['逆光'],
      codec: 'HEVC',
      width: 1920,
      height: 1080,
      favorite: true,
    }),
  ]

  const filters = {
    status: 'favorite' as const,
    resolution: '3840x2160',
    tag: '逆光',
  }

  expect(
    filterAndSortVideoClips(clips, filters, 'a001_c012 hevc').map(
      (clip) => clip.id,
    ),
  ).toEqual(['target'])
  expect(
    filterAndSortVideoClips(clips, filters, '逆光 3840x2160').map(
      (clip) => clip.id,
    ),
  ).toEqual(['target'])
  expect(filterAndSortVideoClips(clips, filters, 'ProRes')).toEqual([])
})

test('搜索包含项目内备注，但不会把备注变成独立筛选维度', () => {
  const clips = [
    makeClip('note-match', {
      note: '夕阳下的高压电塔，保留远景。',
    }),
    makeClip('filename-only', {
      filename: 'sunset.mov',
      note: '',
    }),
  ]

  expect(
    filterAndSortVideoClips(clips, DEFAULT_CLIP_FILTER_STATE, '高压电塔').map(
      (clip) => clip.id,
    ),
  ).toEqual(['note-match'])
  expect(
    filterAndSortVideoClips(clips, DEFAULT_CLIP_FILTER_STATE, 'sunset').map(
      (clip) => clip.id,
    ),
  ).toEqual(['filename-only'])
})

test('日期升降序都把未知日期置后，并稳定保留同日期和未知项顺序', () => {
  const clips = [
    makeClip('unknown-first', { capturedAt: '待分析' }),
    makeClip('same-a', { capturedAt: '2024-05-12 14:35' }),
    makeClip('newest', { capturedAt: '2025-01-01 00:00:01' }),
    makeClip('same-b', { capturedAt: '2024-05-12 14:35' }),
    makeClip('invalid-date', { capturedAt: '2024-02-30 12:00' }),
    makeClip('oldest', { capturedAt: '2023-01-01' }),
  ]

  expect(
    filterAndSortVideoClips(clips, { dateSort: 'newest' }).map(
      (clip) => clip.id,
    ),
  ).toEqual([
    'newest',
    'same-a',
    'same-b',
    'oldest',
    'unknown-first',
    'invalid-date',
  ])
  expect(
    filterAndSortVideoClips(clips, { dateSort: 'oldest' }).map(
      (clip) => clip.id,
    ),
  ).toEqual([
    'oldest',
    'same-a',
    'same-b',
    'newest',
    'unknown-first',
    'invalid-date',
  ])
  expect(getClipCapturedAtSortValue('2024-02-30 12:00')).toBeNull()
  expect(
    filterAndSortVideoClips(clips, { dateSort: 'default' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(clips.map((clip) => clip.id))
})

test('可用分辨率与标签选项去重并保持确定顺序', () => {
  const clips = [
    makeClip('one', {
      width: 1920,
      height: 1080,
      tags: ['逆光', '人物'],
    }),
    makeClip('two', {
      width: 3840,
      height: 2160,
      tags: ['人物', '冷色调'],
    }),
    makeClip('three', {
      width: null,
      height: null,
      resolution: '待分析',
      tags: [' 逆光 '],
    }),
  ]

  expect(getClipResolutionOptions(clips)).toEqual([
    '3840x2160',
    '1920x1080',
    'unknown',
  ])
  expect(getClipTagOptions(clips)).toEqual(['冷色调', '逆光', '人物'])
  expect(
    filterAndSortVideoClips(clips, { tag: '逆光' }).map((clip) => clip.id),
  ).toEqual(['one', 'three'])
})

test('默认顺序以项目引用 order 为准，日期相同时也按 order 稳定补位', () => {
  const clips = [
    makeClip('third', { order: 2 }),
    makeClip('first', { order: 0 }),
    makeClip('second', { order: 1 }),
    makeClip('fallback', { order: null }),
  ]

  expect(
    filterAndSortVideoClips(clips).map((clip) => clip.id),
  ).toEqual(['first', 'second', 'third', 'fallback'])
  expect(
    filterAndSortVideoClips(clips, { dateSort: 'newest' }).map(
      (clip) => clip.id,
    ),
  ).toEqual(['first', 'second', 'third', 'fallback'])
})

test('默认状态无筛选，任一筛选变化后报告为活动状态', () => {
  expect(isClipFilterStateActive(DEFAULT_CLIP_FILTER_STATE)).toBe(false)
  expect(isClipFilterStateActive({ status: 'favorite' })).toBe(true)
  expect(isClipFilterStateActive({ dateSort: 'newest' })).toBe(true)
})
