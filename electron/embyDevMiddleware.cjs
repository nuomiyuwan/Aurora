const {
  EmbyClientError,
  createEmbySessionManager,
  normalizeEmbyError,
} = require('./embyClient.cjs')

const DEFAULT_BASE_PATH = '/__aurora/emby'
const DEFAULT_ALLOWED_ORIGIN = 'http://127.0.0.1:5174'
const MAX_BODY_BYTES = 64 * 1024
const BODY_TIMEOUT_MS = 5_000

function publicError(code, message, status, retryable = false) {
  return new EmbyClientError(code, message, { status, retryable })
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', body.byteLength)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(body)
}

function sendSuccess(response, data) {
  sendJson(response, 200, { ok: true, data })
}

function sendFailure(response, error, fallbackStatus = 400) {
  const normalized = normalizeEmbyError(error)
  const inferredStatus = {
    EMBY_BAD_RESPONSE: 502,
    EMBY_NETWORK_ERROR: 502,
    EMBY_NOT_CONNECTED: 409,
    EMBY_RESPONSE_TOO_LARGE: 502,
    EMBY_TIMEOUT: 504,
    EMBY_UNKNOWN: 500,
  }[normalized.code]
  sendJson(response, normalized.status || inferredStatus || fallbackStatus, {
    ok: false,
    error: normalized,
  })
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      request.resume()
      reject(publicError(
        'EMBY_INVALID_INPUT',
        '请求必须使用 application/json。',
        415,
      ))
      return
    }

    const declaredLength = Number(request.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      request.resume()
      reject(publicError('EMBY_INVALID_INPUT', '请求内容过大。', 413))
      return
    }

    let totalLength = 0
    let tooLarge = false
    const chunks = []
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('aborted', onAborted)
      request.removeListener('error', onError)
    }

    const finish = (operation) => {
      if (settled) return
      settled = true
      cleanup()
      operation()
    }

    const onData = (chunk) => {
      totalLength += chunk.byteLength
      if (totalLength > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    }

    const onEnd = () => {
      finish(() => {
        if (tooLarge) {
          reject(publicError('EMBY_INVALID_INPUT', '请求内容过大。', 413))
          return
        }

        try {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve(text.length === 0 ? {} : JSON.parse(text))
        } catch {
          reject(publicError('EMBY_INVALID_INPUT', 'JSON 请求格式无效。', 400))
        }
      })
    }

    const onAborted = () => {
      finish(() => reject(publicError('EMBY_REQUEST_FAILED', '请求已中止。', 400)))
    }

    const onError = () => {
      finish(() => reject(publicError('EMBY_REQUEST_FAILED', '无法读取请求内容。', 400)))
    }

    const timeout = setTimeout(() => {
      request.resume()
      finish(() => reject(publicError('EMBY_TIMEOUT', '读取请求内容超时。', 408)))
    }, BODY_TIMEOUT_MS)

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('aborted', onAborted)
    request.on('error', onError)
  })
}

function queryRequest(searchParams, fields) {
  const result = {}
  for (const field of fields) {
    const value = searchParams.get(field)
    if (value !== null) result[field] = value
  }
  return result
}

function numberQueryFields(request, fields) {
  for (const field of fields) {
    if (request[field] === undefined) continue
    const value = Number(request[field])
    request[field] = Number.isInteger(value) ? value : Number.NaN
  }
  return request
}

function isSameOriginRequest(request, allowedOrigin, allowedHost) {
  const host = String(request.headers.host || '').toLowerCase()
  if (host !== allowedHost.toLowerCase()) return false

  const origin = request.headers.origin
  if (origin && origin !== allowedOrigin) return false

  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  return true
}

function createEmbyDevMiddleware(options = {}) {
  const basePath = options.basePath || DEFAULT_BASE_PATH
  const allowedOrigin = options.allowedOrigin || DEFAULT_ALLOWED_ORIGIN
  const allowedHost = options.allowedHost || new URL(allowedOrigin).host
  const manager = options.manager || createEmbySessionManager({
    clientName: 'Aurora',
    deviceName: 'Aurora Browser Preview',
    version: options.version || '1.0.0-dev',
    fetchImpl: options.fetchImpl,
  })

  return async function embyDevMiddleware(request, response, next) {
    let url
    try {
      url = new URL(request.url || '/', allowedOrigin)
    } catch {
      next()
      return
    }

    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      next()
      return
    }

    if (!isSameOriginRequest(request, allowedOrigin, allowedHost)) {
      sendFailure(
        response,
        publicError('EMBY_FORBIDDEN', '仅允许 Aurora 本地开发页面访问该接口。', 403),
        403,
      )
      return
    }

    const route = url.pathname.slice(basePath.length) || '/'

    try {
      if (route === '/connection' && request.method === 'GET') {
        sendSuccess(response, manager.getEmbyConnection())
        return
      }

      if (route === '/connection' && request.method === 'DELETE') {
        sendSuccess(response, await manager.disconnectEmby())
        return
      }

      if (route === '/connection/test' && request.method === 'POST') {
        sendSuccess(response, await manager.testEmbyConnection(await readJsonBody(request)))
        return
      }

      if (route === '/search' && request.method === 'POST') {
        sendSuccess(response, await manager.searchEmby(await readJsonBody(request)))
        return
      }

      if (route === '/item' && request.method === 'GET') {
        sendSuccess(response, await manager.getEmbyItem(
          queryRequest(url.searchParams, ['itemId']),
        ))
        return
      }

      if (route === '/playback-info' && request.method === 'GET') {
        sendSuccess(response, await manager.getEmbyPlaybackInfo(
          queryRequest(url.searchParams, ['itemId']),
        ))
        return
      }

      if (route === '/image' && request.method === 'GET') {
        const imageRequest = numberQueryFields(
          queryRequest(url.searchParams, [
            'itemId',
            'type',
            'index',
            'maxWidth',
            'maxHeight',
            'quality',
            'format',
          ]),
          ['index', 'maxWidth', 'maxHeight', 'quality'],
        )
        const image = await manager.getEmbyImage(imageRequest)
        const body = Buffer.from(image.data)

        response.statusCode = 200
        response.setHeader('Content-Type', image.mimeType)
        response.setHeader('Content-Length', body.byteLength)
        response.setHeader('Cache-Control', image.cacheControl || 'private, max-age=300')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (image.etag) response.setHeader('ETag', image.etag)
        response.end(body)
        return
      }

      const knownRoute = [
        '/connection',
        '/connection/test',
        '/search',
        '/item',
        '/image',
        '/playback-info',
      ].includes(route)
      request.resume()
      sendFailure(
        response,
        publicError(
          knownRoute ? 'EMBY_INVALID_INPUT' : 'EMBY_NOT_FOUND',
          knownRoute ? '该接口不支持当前请求方法。' : '未找到开发预览接口。',
          knownRoute ? 405 : 404,
        ),
        knownRoute ? 405 : 404,
      )
    } catch (error) {
      sendFailure(response, error, 400)
    }
  }
}

module.exports = {
  createEmbyDevMiddleware,
}
