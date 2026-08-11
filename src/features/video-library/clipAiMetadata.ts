export interface ClipAiFrameAnalysis {
  frameId: string
  timeSeconds: number
  descriptionZh: string
  keywordsZh: readonly string[]
}

export interface ClipAiMetadataSuggestion {
  tags: string[]
  note: string
}

export interface ImportedClipMetadataPlaceholder {
  tag: string
  note: string
}

const GENERIC_VISUAL_TAGS = new Set([
  '图片',
  '图像',
  '画面',
  '场景',
  '视频',
  '镜头',
  '照片',
])

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/u, '')
  .replace(/\s+/gu, ' ')

const tagKey = (value: string) => value.toLocaleLowerCase('zh-CN')

const truncateText = (value: string, maximum: number) => {
  const characters = Array.from(value)
  if (characters.length <= maximum) return value
  return `${characters.slice(0, Math.max(0, maximum - 1)).join('')}…`
}

const createConciseDescription = (value: string, maximum: number) => {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (!normalized) return ''
  const firstClause = normalized.split(/[。！？；\n]/u)[0]?.trim() ?? ''
  return truncateText(firstClause, maximum)
}

/**
 * Keeps the first and final indexed frames while sampling the middle of a
 * clip evenly. The returned objects are the original candidates so their
 * cache identities stay stable across clip-level and frame-ring analysis.
 */
export function selectClipAiRepresentativeFrames<T>(
  frames: readonly T[],
  maximum = 8,
): T[] {
  if (maximum <= 0 || frames.length === 0) return []
  if (frames.length <= maximum) return [...frames]
  if (maximum === 1) return [frames[Math.floor(frames.length / 2)]]

  const selectedIndexes = new Set<number>()
  for (let index = 0; index < maximum; index += 1) {
    selectedIndexes.add(
      Math.round(index * (frames.length - 1) / (maximum - 1)),
    )
  }
  return [...selectedIndexes].map((index) => frames[index])
}

/**
 * Turns per-frame visual descriptions into one conservative clip-level
 * suggestion. Tags that recur across representative frames rank first; a
 * note is composed from recurring concepts or a representative description.
 */
export function createClipAiMetadataSuggestion(
  frames: readonly ClipAiFrameAnalysis[],
  options: {
    maxTags?: number
    maxTagLength?: number
    maxNoteLength?: number
  } = {},
): ClipAiMetadataSuggestion {
  const maxTags = options.maxTags ?? 6
  const maxTagLength = options.maxTagLength ?? 12
  const maxNoteLength = options.maxNoteLength ?? 40
  const scores = new Map<string, {
    value: string
    frameCount: number
    firstSeen: number
  }>()
  const normalizedFrameTags: string[][] = []

  frames.forEach((frame, frameIndex) => {
    const seenInFrame = new Set<string>()
    const frameTags: string[] = []
    frame.keywordsZh.forEach((keyword) => {
      const normalized = normalizeTag(keyword)
      const key = tagKey(normalized)
      if (
        !normalized ||
        Array.from(normalized).length > maxTagLength ||
        GENERIC_VISUAL_TAGS.has(normalized) ||
        seenInFrame.has(key)
      ) {
        return
      }
      seenInFrame.add(key)
      frameTags.push(normalized)
      const current = scores.get(key)
      scores.set(key, current
        ? { ...current, frameCount: current.frameCount + 1 }
        : { value: normalized, frameCount: 1, firstSeen: frameIndex })
    })
    normalizedFrameTags.push(frameTags)
  })

  const ranked = [...scores.entries()].sort(([, left], [, right]) =>
    right.frameCount - left.frameCount || left.firstSeen - right.firstSeen,
  )
  const tags = ranked.slice(0, Math.max(0, maxTags)).map(([, score]) => score.value)
  const recurringTags = ranked
    .filter(([, score]) => score.frameCount >= 2)
    .slice(0, 4)
    .map(([, score]) => score.value)

  let note = ''
  if (frames.length > 1 && recurringTags.length >= 2) {
    note = `包含${recurringTags.join('、')}等画面`
  } else if (frames.length > 0) {
    const center = (frames.length - 1) / 2
    const representativeIndex = frames.reduce((bestIndex, _frame, index) => {
      const keywordScore = normalizedFrameTags[index].reduce(
        (total, tag) => total + (scores.get(tagKey(tag))?.frameCount ?? 0),
        0,
      )
      const bestKeywordScore = normalizedFrameTags[bestIndex].reduce(
        (total, tag) => total + (scores.get(tagKey(tag))?.frameCount ?? 0),
        0,
      )
      if (keywordScore !== bestKeywordScore) {
        return keywordScore > bestKeywordScore ? index : bestIndex
      }
      return Math.abs(index - center) < Math.abs(bestIndex - center)
        ? index
        : bestIndex
    }, 0)
    note = createConciseDescription(
      frames[representativeIndex]?.descriptionZh ?? '',
      maxNoteLength,
    )
  }
  if (!note && tags.length > 0) note = `包含${tags.slice(0, 4).join('、')}等画面`

  return {
    tags,
    note: truncateText(note, maxNoteLength),
  }
}

export function mergeClipAiTags(
  existingTags: readonly string[],
  selectedTags: readonly string[],
  maximum = 6,
) {
  const seen = new Set<string>()
  const merged: string[] = []
  existingTags.forEach((tag) => {
    const preserved = tag.trim()
    const key = tagKey(normalizeTag(preserved))
    if (!preserved || !key || seen.has(key)) return
    seen.add(key)
    merged.push(preserved)
  })
  selectedTags.forEach((tag) => {
    const normalized = normalizeTag(tag)
    const key = tagKey(normalized)
    if (!normalized || seen.has(key)) return
    seen.add(key)
    merged.push(normalized)
  })
  return merged.slice(0, Math.max(0, maximum))
}

/**
 * Automatic analysis only replaces untouched import placeholders. If a user
 * edits either field while the model is running, that field is preserved.
 */
export function createImportedClipAiMetadataPatch(
  current: { tags: readonly string[]; note: string },
  suggestion: ClipAiMetadataSuggestion,
  placeholder: ImportedClipMetadataPlaceholder,
): { tags?: string[]; note?: string } | null {
  const patch: { tags?: string[]; note?: string } = {}
  if (
    current.tags.length === 1 &&
    current.tags[0] === placeholder.tag &&
    suggestion.tags.length > 0
  ) {
    patch.tags = [...suggestion.tags]
  }
  if (current.note === placeholder.note && suggestion.note) {
    patch.note = suggestion.note
  }
  return patch.tags || patch.note ? patch : null
}
