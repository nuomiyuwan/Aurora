import { expect, test } from '@playwright/test'

test('tries an available source immediately and only prepares a proxy after failure', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const {
      canPlayFrameRingVideoSource,
      parseFrameRingDurationSeconds,
      resolveFrameRingMediaDurationForSource,
      resolveFrameRingPlaybackDurationSeconds,
      resolveFrameRingPreviewTask,
      shouldFallbackAfterFrameRingVideoDecodeWatchdog,
    } = await import('/src/features/frame-ring/frameRingData.ts')
    const { requiresKnownVideoPreviewProxy } = await import(
      '/src/features/videoPlaybackCompatibility.ts'
    )

    return {
      directPlayback: canPlayFrameRingVideoSource(
        'aurora-media://file/example',
        false,
      ),
      failedPlayback: canPlayFrameRingVideoSource(
        'aurora-media://file/example',
        true,
      ),
      missingSource: canPlayFrameRingVideoSource(null, false),
      directStatus: resolveFrameRingPreviewTask(
        'aurora-media://file/example',
      ),
      preparingFallback: resolveFrameRingPreviewTask(
        'aurora-media://file/example',
        'preparing',
      ),
      missingStatus: resolveFrameRingPreviewTask(null),
      knownMpeg4Proxy: requiresKnownVideoPreviewProxy('MPEG4'),
      knownMpeg4Part2Proxy:
        requiresKnownVideoPreviewProxy('MPEG-4 Part 2'),
      hevcRemainsDirectFirst: requiresKnownVideoPreviewProxy('HEVC'),
      runtimeDurationRepairsFallback:
        resolveFrameRingPlaybackDurationSeconds(null, '待分析', 35.166667),
      runtimeDurationRepairsStaleMetadata:
        resolveFrameRingPlaybackDurationSeconds(1, '00:01', 35.166667),
      persistedDurationProtectsAgainstTruncatedRuntime:
        resolveFrameRingPlaybackDurationSeconds(35.166667, '00:35', 1),
      timecodeDurationDoesNotCollapseToOneSecond:
        parseFrameRingDurationSeconds('00:00:35:12'),
      currentSourceRuntimeDuration: resolveFrameRingMediaDurationForSource(
        { sourceKey: 'clip-a\u0000proxy-a', durationSeconds: 35.166667 },
        'clip-a\u0000proxy-a',
      ),
      staleSourceRuntimeDurationIgnored: resolveFrameRingMediaDurationForSource(
        { sourceKey: 'clip-a\u0000proxy-a', durationSeconds: 35.166667 },
        'clip-b\u0000proxy-b',
      ),
      stalledVisualTrack:
        shouldFallbackAfterFrameRingVideoDecodeWatchdog({
          playing: true,
          documentVisible: true,
          monitoringSupported: true,
          elapsedMediaTime: 1.4,
          observedAdvancingVideoFrame: false,
          decodedFrameCountBefore: 0,
          decodedFrameCountAfter: 0,
        }),
      advancingCallback:
        shouldFallbackAfterFrameRingVideoDecodeWatchdog({
          playing: true,
          documentVisible: true,
          monitoringSupported: true,
          elapsedMediaTime: 1.4,
          observedAdvancingVideoFrame: true,
          decodedFrameCountBefore: 0,
          decodedFrameCountAfter: 0,
        }),
      advancingDecodedFrames:
        shouldFallbackAfterFrameRingVideoDecodeWatchdog({
          playing: true,
          documentVisible: true,
          monitoringSupported: true,
          elapsedMediaTime: 1.4,
          observedAdvancingVideoFrame: false,
          decodedFrameCountBefore: 8,
          decodedFrameCountAfter: 12,
        }),
      bufferingDoesNotFallback:
        shouldFallbackAfterFrameRingVideoDecodeWatchdog({
          playing: true,
          documentVisible: true,
          monitoringSupported: true,
          elapsedMediaTime: 0.1,
          observedAdvancingVideoFrame: false,
          decodedFrameCountBefore: 0,
          decodedFrameCountAfter: 0,
        }),
    }
  })

  expect(result).toEqual({
    directPlayback: true,
    failedPlayback: false,
    missingSource: false,
    directStatus: 'ready',
    preparingFallback: 'preparing',
    missingStatus: 'failed',
    knownMpeg4Proxy: true,
    knownMpeg4Part2Proxy: true,
    hevcRemainsDirectFirst: false,
    runtimeDurationRepairsFallback: 35.166667,
    runtimeDurationRepairsStaleMetadata: 35.166667,
    persistedDurationProtectsAgainstTruncatedRuntime: 35.166667,
    timecodeDurationDoesNotCollapseToOneSecond: 35,
    currentSourceRuntimeDuration: 35.166667,
    staleSourceRuntimeDurationIgnored: null,
    stalledVisualTrack: true,
    advancingCallback: false,
    advancingDecodedFrames: false,
    bufferingDoesNotFallback: false,
  })
})
