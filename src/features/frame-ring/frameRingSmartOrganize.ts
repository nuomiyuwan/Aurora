export type FrameRingSmartSensitivity =
  | 'conservative'
  | 'balanced'
  | 'aggressive'

export type FrameRingBlankKind = 'black' | 'white'

export interface FrameRingBlankCandidate {
  frameId: string
  kind: FrameRingBlankKind
  confidence: number
  reason: string
}

export interface FrameRingDuplicateGroup {
  id: string
  keepFrameId: string
  removeFrameIds: string[]
  reason: string
  confidence: number
}

export interface FrameRingSmartScanResult {
  version: number
  blankCandidates: FrameRingBlankCandidate[]
  duplicateGroups: FrameRingDuplicateGroup[]
}

export interface FrameRingVisualSuggestion {
  frameId: string
  descriptionZh: string
  keywordsZh: string[]
}

export interface FrameRingAnnotationSuggestion {
  frameId: string
  tags: string[]
  note: string
}

export interface FrameRingSmartApplyRequest {
  exclusions: Array<{
    frameId: string
    reason: FrameRingBlankKind | 'duplicate'
    duplicateOfFrameId: string | null
  }>
  annotations: FrameRingAnnotationSuggestion[]
}

export interface FrameRingSmartApplyResult {
  excludedCount: number
  annotatedCount: number
}

const normalizeTag = (value: string) => value.trim().replace(/^#+/, '')

const splitDescription = (description: string) => {
  const normalized = description.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  const firstSentence = normalized.split(/[。！？；\n]/u)[0]?.trim() ?? ''
  if (Array.from(firstSentence).length <= 20) return firstSentence

  const clauses = firstSentence
    .split(/[，,：:]/u)
    .map((clause) => clause.trim())
    .filter(Boolean)
  let concise = ''
  for (const clause of clauses) {
    const candidate = concise ? `${concise}，${clause}` : clause
    if (Array.from(candidate).length > 20) break
    concise = candidate
  }
  if (concise) return concise

  return Array.from(firstSentence)
    .slice(0, 20)
    .join('')
    .replace(/[，,：:、；;\s]+$/u, '')
}

export function createFrameRingAnnotationSuggestion(
  suggestion: FrameRingVisualSuggestion,
): FrameRingAnnotationSuggestion {
  const seen = new Set<string>()
  const tags = suggestion.keywordsZh.flatMap((keyword) => {
    const normalized = normalizeTag(keyword)
    if (
      !normalized ||
      normalized.length > 12 ||
      seen.has(normalized)
    ) {
      return []
    }
    seen.add(normalized)
    return [normalized]
  }).slice(0, 6)

  return {
    frameId: suggestion.frameId,
    tags,
    note: splitDescription(suggestion.descriptionZh),
  }
}

export function getFrameRingSmartExcludedFrameIds(
  scan: FrameRingSmartScanResult,
) {
  return new Set([
    ...scan.blankCandidates.map((candidate) => candidate.frameId),
    ...scan.duplicateGroups.flatMap((group) => group.removeFrameIds),
  ])
}
