import { expect, test } from '@playwright/test'
import {
  createFrameRingAnnotationSuggestion,
  getFrameRingSmartExcludedFrameIds,
} from '../src/features/frame-ring/frameRingSmartOrganize'

test('normalizes visual keywords and creates a concise Chinese frame note', () => {
  expect(createFrameRingAnnotationSuggestion({
    frameId: 'frame-1',
    descriptionZh: '一名人物站在雪山湖面前，远处有蓝色晨雾。还有更多描述。',
    keywordsZh: ['#人物', '雪山', '人物', '晨雾', '', '湖面'],
  })).toEqual({
    frameId: 'frame-1',
    tags: ['人物', '雪山', '晨雾', '湖面'],
    note: '一名人物站在雪山湖面前，远处有蓝色晨雾',
  })
})

test('keeps a complete concise clause instead of appending a truncation ellipsis', () => {
  const suggestion = createFrameRingAnnotationSuggestion({
    frameId: 'frame-long-note',
    descriptionZh: '航拍镜头展示大型工业园区与纵横交错的道路，远处可见连绵山脉和清晨薄雾。',
    keywordsZh: ['工业园区', '航拍', '道路'],
  })

  expect(suggestion.note).toBe('航拍镜头展示大型工业园区与纵横交错的道路')
  expect(Array.from(suggestion.note)).toHaveLength(20)
  expect(suggestion.note).not.toContain('…')
})

test('collects blank and duplicate removal candidates without selecting keep frames', () => {
  const frameIds = getFrameRingSmartExcludedFrameIds({
    version: 1,
    blankCandidates: [
      { frameId: 'black', kind: 'black', confidence: 0.99, reason: 'pure black' },
    ],
    duplicateGroups: [
      {
        id: 'duplicate-1',
        keepFrameId: 'keep',
        removeFrameIds: ['duplicate-a', 'duplicate-b'],
        confidence: 0.96,
        reason: 'near duplicate',
      },
    ],
  })

  expect([...frameIds]).toEqual(['black', 'duplicate-a', 'duplicate-b'])
  expect(frameIds.has('keep')).toBe(false)
})
