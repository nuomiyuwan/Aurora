import { expect, test } from '@playwright/test'
import {
  formatMediaFileSize,
  getStandardResolutionBadge,
} from '../src/features/video-library/mediaDisplayMetadata'

test('只为真实标准画幅显示分辨率徽标', () => {
  expect(getStandardResolutionBadge(3840, 2160)).toBe('4K')
  expect(getStandardResolutionBadge(4096, 2160)).toBe('4K')
  expect(getStandardResolutionBadge(1920, 1080)).toBe('1080P')
  expect(getStandardResolutionBadge(1080, 1920)).toBe('1080P')
  expect(getStandardResolutionBadge(2560, 1440)).toBe('1440P')
  expect(getStandardResolutionBadge(3200, 1800)).toBeNull()
  expect(getStandardResolutionBadge(3840, 1600)).toBeNull()
  expect(getStandardResolutionBadge(null, null, '3840 x 2160')).toBe('4K')
  expect(getStandardResolutionBadge(null, null, '待分析')).toBeNull()
})

test('按真实字节数在 KB、MB 与 GB 间自动切换', () => {
  expect(formatMediaFileSize(500 * 1024)).toBe('500 KB')
  expect(formatMediaFileSize(1024 ** 2 - 1)).toMatch(/ KB$/)
  expect(formatMediaFileSize(1024 ** 2)).toBe('1 MB')
  expect(formatMediaFileSize(900 * 1024 ** 2)).toBe('900 MB')
  expect(formatMediaFileSize(1024 ** 3 - 1)).toMatch(/ MB$/)
  expect(formatMediaFileSize(1024 ** 3)).toBe('1 GB')
  expect(formatMediaFileSize(18.7 * 1024 ** 3)).toBe('18.7 GB')
  expect(formatMediaFileSize(0)).toBe('待分析')
})
