import type { OnlineMediaProvider } from '../../data/onlineProviderRegistry'

function readFailureText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message}`
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return ''
  const candidate = error as { code?: unknown; message?: unknown }
  return [candidate.code, candidate.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
}

export function getOnlineSearchFailureStatus(
  provider: OnlineMediaProvider,
  error: unknown,
  retryAfterAction = false,
) {
  if (provider !== 'douyin') return null
  const text = readFailureText(error)
  if (/DOUYIN_LOGIN_REQUIRED|请先登录抖音/u.test(text)) {
    return retryAfterAction
      ? '请先在右上角账号中心登录抖音，再点击此处重试'
      : '请先在右上角账号中心登录抖音，再搜索视频'
  }
  if (
    /DOUYIN_VERIFICATION_REQUIRED|抖音需要完成浏览器验证|完成抖音浏览器验证/u
      .test(text)
  ) {
    return retryAfterAction
      ? '请在弹出的抖音窗口完成验证，再点击此处重试'
      : '请在弹出的抖音窗口完成验证，完成后重新搜索'
  }
  return null
}
