import { expect, test } from '@playwright/test'
import {
  createClipAiMetadataSuggestion,
  createImportedClipAiMetadataPatch,
  mergeClipAiTags,
  selectClipAiRepresentativeFrames,
} from '../src/features/video-library/clipAiMetadata'

test('均匀选择片段代表帧并保留首尾画面', () => {
  const frames = Array.from({ length: 20 }, (_, index) => index)
  const selected = selectClipAiRepresentativeFrames(frames, 8)

  expect(selected).toHaveLength(8)
  expect(selected[0]).toBe(0)
  expect(selected.at(-1)).toBe(19)
  expect(new Set(selected).size).toBe(8)
})

test('优先汇总跨关键帧重复出现的标签并生成片段备注', () => {
  const suggestion = createClipAiMetadataSuggestion([
    {
      frameId: 'frame-1',
      timeSeconds: 0,
      descriptionZh: '一名人物走在雪山湖边。',
      keywordsZh: ['#人物', '雪山', '湖泊', '画面'],
    },
    {
      frameId: 'frame-2',
      timeSeconds: 5,
      descriptionZh: '人物站在湖边望向雪山。',
      keywordsZh: ['人物', '湖泊', '雪山', '人物'],
    },
    {
      frameId: 'frame-3',
      timeSeconds: 10,
      descriptionZh: '远处雪山和湖泊被晨雾覆盖。',
      keywordsZh: ['晨雾', '雪山', '湖泊'],
    },
  ])

  expect(suggestion.tags).toEqual(['雪山', '湖泊', '人物', '晨雾'])
  expect(suggestion.note).toBe('包含雪山、湖泊、人物等画面')
})

test('确认应用时保留原标签、忽略重复项并遵守数量上限', () => {
  expect(mergeClipAiTags(
    ['人物', '夜景'],
    ['#人物', '城市', '霓虹', '街道', '雨天', '汽车'],
    6,
  )).toEqual(['人物', '夜景', '城市', '霓虹', '街道', '雨天'])
})

test('自动标注只替换仍未被用户编辑的导入占位内容', () => {
  const placeholder = {
    tag: '新导入',
    note: '刚导入 Aurora，等待后续建立视觉索引。',
  }
  const suggestion = {
    tags: ['城市', '夜景'],
    note: '包含城市、夜景等画面',
  }

  expect(createImportedClipAiMetadataPatch(
    { tags: ['新导入'], note: placeholder.note },
    suggestion,
    placeholder,
  )).toEqual(suggestion)
  expect(createImportedClipAiMetadataPatch(
    { tags: ['人工标签'], note: '人工备注' },
    suggestion,
    placeholder,
  )).toBeNull()
})
