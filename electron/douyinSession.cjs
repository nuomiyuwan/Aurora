const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const DOUYIN_PARTITION = 'persist:aurora-online-douyin-v1'
const DOUYIN_HOST = 'www.douyin.com'
const DOUYIN_LOGIN_URL = `https://${DOUYIN_HOST}/`
const DOUYIN_AUTH_COOKIE_NAMES = Object.freeze([
  'sessionid',
  'sessionid_ss',
  'sid_guard',
])
const VIDEO_ID_PATTERN = /^[1-9][0-9]{18}$/
const MAX_QUERY_LENGTH = 160
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 20
const MAX_PAGE = 100
const MAX_COVER_BYTES = 12 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 40_000
const VERIFICATION_POLL_MS = 1_000
const PLAYER_AUTOPLAY_RETRY_MS = 180
const PLAYER_AUTOPLAY_MAX_ATTEMPTS = 12
const DOUYIN_PLAYER_CONTAIN_CSS = `
html,
body,
#root,
.container-pc {
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  background: #000 !important;
}
`
const DOUYIN_PLAYER_AUTOPLAY_SCRIPT = `
(() => {
  const video = document.querySelector('video');
  if (!(video instanceof HTMLMediaElement)) return false;
  if (!video.paused && !video.ended) return true;
  return Promise.resolve(video.play()).then(
    () => true,
    () => false,
  );
})()
`
const IMAGE_CONTENT_TYPES = new Map([
  ['image/avif', '.avif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const GENERIC_IMAGE_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
])

const READ_DOUYIN_VERIFICATION_RESOLVED_SCRIPT = `
(() => {
  const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const text = compact(document.body?.innerText);
  const challengeVisible = /完成验证|安全验证|验证码/.test(text) ||
    Boolean(document.querySelector(
      'iframe[src*="captcha"], iframe[src*="verify"], [id*="captcha"], [class*="captcha"]'
    ));
  const searchPage = location.hostname === 'www.douyin.com' &&
    location.pathname.startsWith('/search/');
  const searchSettled = Boolean(document.querySelector('a[href*="/video/"]')) ||
    /暂无搜索结果|没有找到相关/.test(text);
  return searchPage && !challengeVisible && searchSettled;
})()
`

class DouyinSearchError extends Error {
  constructor(message, code, retryable = false) {
    super(message)
    this.name = 'DouyinSearchError'
    this.code = code
    this.retryable = retryable
  }
}

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function parseSecureUrl(value) {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443')
    ) return null
    return parsed
  } catch {
    return null
  }
}

function normalizeDouyinVideoId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return VIDEO_ID_PATTERN.test(text) ? text : null
}

function createDouyinVideoUrl(videoId) {
  const normalized = normalizeDouyinVideoId(videoId)
  if (!normalized) throw new TypeError('A valid Douyin video ID is required')
  return `https://${DOUYIN_HOST}/video/${normalized}`
}

function createDouyinOfficialPlayerUrl(videoId) {
  const normalized = normalizeDouyinVideoId(videoId)
  if (!normalized) throw new TypeError('A valid Douyin video ID is required')
  return `https://open.douyin.com/player/video?vid=${normalized}&autoplay=1`
}

function createDouyinInteractionUrl(videoId) {
  const normalized = normalizeDouyinVideoId(videoId)
  if (!normalized) throw new TypeError('A valid Douyin video ID is required')
  return `https://${DOUYIN_HOST}/jingxuan?modal_id=${normalized}`
}

function parseDouyinOfficialPlayerUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed || parsed.hostname.toLowerCase() !== 'open.douyin.com' ||
    parsed.pathname !== '/player/video' || parsed.hash
  ) return null
  const entries = [...parsed.searchParams.entries()]
  if (
    entries.length !== 2 ||
    parsed.searchParams.getAll('vid').length !== 1 ||
    parsed.searchParams.getAll('autoplay').length !== 1 ||
    parsed.searchParams.get('autoplay') !== '1'
  ) return null
  const mediaId = normalizeDouyinVideoId(parsed.searchParams.get('vid'))
  if (!mediaId) return null
  return {
    source: 'douyin',
    kind: 'video',
    mediaId,
    url: createDouyinOfficialPlayerUrl(mediaId),
    canonicalUrl: createDouyinVideoUrl(mediaId),
  }
}

function parseDouyinInteractionPopupUrl(value, expectedVideoId) {
  const expectedMediaId = normalizeDouyinVideoId(expectedVideoId)
  const parsed = parseSecureUrl(value)
  if (!expectedMediaId || !parsed || parsed.hash) return null

  const hostname = parsed.hostname.toLowerCase()
  let mediaId = null
  if (hostname === DOUYIN_HOST && parsed.pathname === '/') {
    const entries = [...parsed.searchParams.entries()]
    if (
      entries.length !== 2 ||
      parsed.searchParams.getAll('previous_page').length !== 1 ||
      parsed.searchParams.get('previous_page') !== 'web_code_link' ||
      parsed.searchParams.getAll('vid').length !== 1
    ) return null
    mediaId = normalizeDouyinVideoId(parsed.searchParams.get('vid'))
  } else if (hostname === DOUYIN_HOST && parsed.pathname === '/jingxuan') {
    const entries = [...parsed.searchParams.entries()]
    const hasPreviousPage = parsed.searchParams.has('previous_page')
    if (
      entries.length !== (hasPreviousPage ? 2 : 1) ||
      parsed.searchParams.getAll('modal_id').length !== 1 ||
      (hasPreviousPage && (
        parsed.searchParams.getAll('previous_page').length !== 1 ||
        parsed.searchParams.get('previous_page') !== 'web_code_link'
      ))
    ) return null
    mediaId = normalizeDouyinVideoId(parsed.searchParams.get('modal_id'))
  } else if (hostname === 'm.douyin.com' && !parsed.search) {
    const match = /^\/share\/video\/([1-9][0-9]{18})\/?$/.exec(parsed.pathname)
    mediaId = normalizeDouyinVideoId(match?.[1])
  }
  if (mediaId !== expectedMediaId) return null

  const canonicalUrl = createDouyinVideoUrl(mediaId)
  return {
    source: 'douyin',
    kind: 'video',
    mediaId,
    url: createDouyinInteractionUrl(mediaId),
    canonicalUrl,
  }
}

function parseDouyinVideoUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed ||
    !['douyin.com', DOUYIN_HOST].includes(parsed.hostname.toLowerCase()) ||
    parsed.hash
  ) return null
  const match = /^\/video\/([1-9][0-9]{18})\/?$/.exec(parsed.pathname)
  const mediaId = normalizeDouyinVideoId(match?.[1])
  if (!mediaId) return null
  const canonicalUrl = createDouyinVideoUrl(mediaId)
  return {
    source: 'douyin',
    kind: 'video',
    mediaId,
    url: canonicalUrl,
    canonicalUrl,
  }
}

function normalizeQuery(value) {
  const query = boundedText(value, MAX_QUERY_LENGTH)
  if (!query) throw new TypeError('A non-empty Douyin search query is required')
  return query
}

function normalizePage(value) {
  const page = Number(value ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new TypeError('Douyin search page is out of range')
  }
  return page
}

function normalizeLimit(value) {
  const limit = Number(value ?? DEFAULT_LIMIT)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError('Douyin search limit is out of range')
  }
  return limit
}

function createDouyinSearchUrl(query) {
  const normalized = normalizeQuery(query)
  return `https://${DOUYIN_HOST}/search/${encodeURIComponent(normalized)}?type=video`
}

function normalizeDouyinCoverUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hash) return null
  const host = parsed.hostname.toLowerCase()
  if (
    !host.endsWith('.douyinpic.com') &&
    host !== 'douyinpic.com' &&
    !host.endsWith('.byteimg.com') &&
    host !== 'byteimg.com' &&
    !host.endsWith('.pstatp.com') &&
    host !== 'pstatp.com'
  ) return null
  return parsed.toString()
}

function isAllowedDouyinAuthNavigationUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed) return false
  const host = parsed.hostname.toLowerCase()
  return (
    host === 'douyin.com' || host.endsWith('.douyin.com') ||
    host === 'bytedance.com' || host.endsWith('.bytedance.com') ||
    host === 'snssdk.com' || host.endsWith('.snssdk.com')
  )
}

function extractTags(value) {
  const tags = []
  const seen = new Set()
  for (const match of String(value ?? '').matchAll(/#([^#\s]{1,40})/gu)) {
    const tag = boundedText(match[1], 40)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
    if (tags.length >= 12) break
  }
  return tags
}

function normalizeDouyinSearchPayload(payload, options = {}) {
  const query = normalizeQuery(options.query)
  const page = normalizePage(options.page)
  const pageSize = normalizeLimit(options.limit)
  const defaultOffset = (page - 1) * pageSize
  const requestedOffset = options.offset === undefined
    ? defaultOffset
    : Number(options.offset)
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
    throw new TypeError('Douyin search offset is out of range')
  }
  const allowPartial = options.allowPartial === true
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DouyinSearchError(
      '抖音搜索页面没有返回有效结果，请稍后重试。',
      'DOUYIN_SEARCH_INVALID_RESPONSE',
      true,
    )
  }
  if (payload.loginRequired) {
    throw new DouyinSearchError(
      '请先登录抖音，再搜索视频。',
      'DOUYIN_LOGIN_REQUIRED',
      false,
    )
  }
  if (payload.verificationRequired) {
    throw new DouyinSearchError(
      '抖音需要完成浏览器验证，验证后请重新搜索。',
      'DOUYIN_VERIFICATION_REQUIRED',
      true,
    )
  }
  if (payload.parserMismatch) {
    throw new DouyinSearchError(
      '抖音搜索页已显示视频，但 Aurora 暂时无法识别当前卡片结构，请重试。',
      'DOUYIN_SEARCH_PARSE_FAILED',
      true,
    )
  }
  const allResults = []
  const seen = new Set()
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const parsed = parseDouyinVideoUrl(item.href ?? item.canonicalUrl ?? item.url)
    if (!parsed || seen.has(parsed.mediaId)) continue
    seen.add(parsed.mediaId)
    const title = boundedText(item.title, 300) || `抖音视频 ${parsed.mediaId}`
    allResults.push({
      ...parsed,
      title,
      description: boundedText(item.description, 2_000) || title,
      author: boundedText(item.author, 300) || '抖音创作者',
      coverUrl: normalizeDouyinCoverUrl(item.coverUrl),
      duration: boundedText(item.duration, 80),
      publishedAt: boundedText(item.publishedAt, 100),
      tags: extractTags(title),
    })
  }

  const start = requestedOffset
  const results = allResults.slice(start, start + pageSize)
  const hasBufferedNext = allResults.length > start + pageSize
  const hasCompletePage = results.length === pageSize
  const hasCommittablePartialPage = allowPartial && results.length > 0
  if (payload.incomplete && !hasCompletePage && !hasCommittablePartialPage) {
    throw new DouyinSearchError(
      '抖音还在加载更多视频，请重试本次加载。',
      'DOUYIN_SEARCH_INCOMPLETE',
      true,
    )
  }
  const hasMore = hasBufferedNext || (
    payload.exhausted !== true && payload.hasMore === true &&
    (hasCompletePage || hasCommittablePartialPage)
  )
  const reportedTotal = Number(payload.totalCount)
  const totalCount = Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
    ? Math.max(allResults.length, reportedTotal)
    : allResults.length
  return {
    query,
    page,
    pageSize,
    totalCount,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    results,
  }
}

// Aurora reads only links, titles and public poster URLs rendered by the
// official Douyin search page. It deliberately never reads media stream URLs,
// signs private APIs, or interferes with login/challenge UI.
function createDouyinPageSearchScript({ page, limit, offset }) {
  const normalizedOffset = Number.isSafeInteger(offset) && offset >= 0
    ? offset
    : (page - 1) * limit
  // A page is complete once the requested slice is available. Waiting for an
  // extra look-ahead item made exact/short official batches sit on the loading
  // state until the 36 second script deadline even though the page itself was
  // already ready.
  const targetCount = normalizedOffset + limit
  return `
(() => new Promise(async (resolve) => {
  const requestOffset = ${normalizedOffset};
  const targetCount = ${targetCount};
  const deadline = Date.now() + 36000;
  const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
  const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 && element.getClientRects().length > 0;
  };
  const readBlockingState = () => {
    const bodyText = compact(document.body?.innerText);
    const loginRequired = /登录后即可搜索更多精彩视频|登录后搜索/.test(bodyText);
    const challengeElement = Array.from(document.querySelectorAll(
      'iframe[src*="captcha"], iframe[src*="verify"], [id*="captcha"], ' +
      '[class*="captcha"], [data-e2e*="captcha"], [data-e2e*="verify"]'
    )).find(isVisible);
    const verificationRequired = /完成验证|安全验证|验证码/.test(bodyText) ||
      /(?:verify|captcha)/i.test(location.pathname) || Boolean(challengeElement);
    return { loginRequired, verificationRequired };
  };
  const initialBlockingState = readBlockingState();
  if (initialBlockingState.loginRequired || initialBlockingState.verificationRequired) {
    resolve({ ...initialBlockingState, items: [], hasMore: false });
    return;
  }

  const memory = window.__auroraDouyinSearchResults instanceof Map
    ? window.__auroraDouyinSearchResults
    : new Map();
  window.__auroraDouyinSearchResults = memory;

  const exactVideoId = (value) => {
    const text = compact(value);
    return /^[1-9][0-9]{18}$/.test(text) ? text : '';
  };
  const videoIdFromUrl = (value) => {
    let parsed;
    try { parsed = new URL(String(value || ''), location.href); }
    catch {
      try { parsed = new URL(String(value || ''), 'https://www.douyin.com/'); }
      catch { return ''; }
    }
    const pathMatch = /^\\/video\\/([1-9][0-9]{18})\\/?$/.exec(parsed.pathname);
    if (pathMatch) return pathMatch[1];
    for (const name of ['modal_id', 'aweme_id', 'awemeId', 'item_id', 'itemId']) {
      const candidate = exactVideoId(parsed.searchParams.get(name));
      if (candidate) return candidate;
    }
    return '';
  };
  const videoIdFromElement = (element) => {
    if (!element) return '';
    const direct = videoIdFromUrl(element.href || element.getAttribute?.('href'));
    if (direct) return direct;
    const attributeNames = [
      'data-aweme-id', 'data-awemeid', 'data-item-id', 'data-itemid',
      'data-video-id', 'data-videoid', 'data-home-video-id',
    ];
    let current = element;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      for (const name of attributeNames) {
        const candidate = exactVideoId(current.getAttribute?.(name));
        if (candidate) return candidate;
      }
    }
    return '';
  };

  const findCard = (anchor) => {
    const semanticCard = anchor.closest?.(
      'li, article, [data-e2e*="search-card"], [data-e2e*="video-card"]'
    );
    if (semanticCard) return semanticCard;
    let current = anchor;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (!current.querySelector) continue;
      const hasVisual = current.querySelector('img, video[poster]');
      const text = compact(current.innerText);
      if (hasVisual && text.length >= 2 && text.length < 5000) return current;
    }
    return anchor.parentElement || anchor;
  };
  const usableImage = (element) => {
    const value = element?.currentSrc || element?.src ||
      element?.getAttribute?.('data-src') || element?.getAttribute?.('data-lazy-src') ||
      element?.getAttribute?.('poster') || '';
    return /^https:\\/\\//i.test(value) ? value : '';
  };
  const backgroundImage = (card) => {
    for (const element of card?.querySelectorAll?.('[style*="background"]') || []) {
      const inline = String(element.style?.backgroundImage || '');
      const computed = inline || String(getComputedStyle(element).backgroundImage || '');
      const match = /url\\(["']?(https:\\/\\/[^"')]+)["']?\\)/i.exec(computed);
      if (match) return match[1].replace(/&amp;/g, '&');
    }
    return '';
  };
  const isDuration = (line) => /^\\d{1,2}:\\d{2}(?::\\d{2})?$/.test(line);
  const isPublishedAt = (line) => /^(?:\\d+分钟前|\\d+小时前|\\d+天前|\\d+周前|\\d+月前|\\d+年前|昨天|前天|\\d{1,2}-\\d{1,2}|\\d{4}-\\d{1,2}-\\d{1,2})$/.test(line);
  const isCount = (line) => /^\\d+(?:\\.\\d+)?(?:万|亿)?$/.test(line);
  const isMetadata = (line) =>
    isDuration(line) || isPublishedAt(line) || isCount(line) ||
    /^(?:合集|图文|置顶|点赞|评论|分享|收藏|播放)$/.test(line) || line.startsWith('@');
  const bestTitleFromLines = (lines) => lines
    .filter((line) => line.length >= 2 && line.length <= 2000 && !isMetadata(line))
    .sort((left, right) => right.length - left.length)[0] || '';
  const addRecord = (videoId, item) => {
    if (!exactVideoId(videoId)) return false;
    const existing = memory.get(videoId) || {};
    const incomingTitle = compact(item.title);
    const incomingDescription = compact(item.description) || incomingTitle;
    const chooseLonger = (current, incoming) =>
      incoming.length > compact(current).length ? incoming : compact(current);
    const next = {
      href: 'https://www.douyin.com/video/' + videoId,
      title: chooseLonger(existing.title, incomingTitle),
      description: chooseLonger(existing.description, incomingDescription),
      author: existing.author || compact(item.author).replace(/^@/, ''),
      coverUrl: existing.coverUrl || usableImage({ src: item.coverUrl }),
      duration: existing.duration || compact(item.duration),
      publishedAt: existing.publishedAt || compact(item.publishedAt),
    };
    const isNew = !memory.has(videoId);
    memory.set(videoId, next);
    return isNew;
  };
  const collectJsonRecords = () => {
    const scripts = Array.from(document.querySelectorAll(
      'script[type="application/json"], script#RENDER_DATA, script#__NEXT_DATA__, script#__UNIVERSAL_DATA_FOR_REHYDRATION__'
    ));
    const processed = window.__auroraDouyinProcessedJsonScripts instanceof Set
      ? window.__auroraDouyinProcessedJsonScripts
      : new Set();
    window.__auroraDouyinProcessedJsonScripts = processed;
    for (const script of scripts) {
      const raw = String(script.textContent || '');
      const signature = (script.id || script.type || 'json') + ':' + raw.length + ':' + raw.slice(0, 80);
      if (!raw || raw.length > 5000000 || processed.has(signature)) continue;
      processed.add(signature);
      let parsed;
      try {
        const decoded = /^%(?:7B|5B)/i.test(raw.trim()) ? decodeURIComponent(raw) : raw;
        parsed = JSON.parse(decoded);
      } catch { continue; }
      const queue = [parsed];
      const visited = new Set();
      let inspected = 0;
      while (queue.length && inspected < 60000) {
        const value = queue.shift();
        if (!value || typeof value !== 'object' || visited.has(value)) continue;
        visited.add(value);
        inspected += 1;
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === 'object') queue.push(child);
          continue;
        }
        const hasPublicMediaFields = Boolean(
          value.desc || value.title || value.caption || value.author ||
          value.video?.cover || value.video?.origin_cover || value.cover || value.origin_cover
        );
        const candidateId = hasPublicMediaFields ? exactVideoId(
          value.aweme_id || value.awemeId || value.item_id || value.itemId ||
          value.video_id || value.videoId || value.id
        ) : '';
        if (candidateId) {
          const cover = value.video?.cover || value.video?.origin_cover ||
            value.video?.dynamic_cover || value.cover || value.origin_cover || value.dynamic_cover;
          const coverUrl = Array.isArray(cover?.url_list) ? cover.url_list[0]
            : Array.isArray(cover?.urlList) ? cover.urlList[0]
              : typeof cover === 'string' ? cover : cover?.url;
          const durationValue = Number(value.duration ?? value.video?.duration);
          const durationSeconds = Number.isFinite(durationValue)
            ? Math.round(durationValue >= 1000 ? durationValue / 1000 : durationValue)
            : 0;
          const duration = durationSeconds > 0
            ? String(Math.floor(durationSeconds / 60)).padStart(2, '0') + ':' +
              String(durationSeconds % 60).padStart(2, '0')
            : '';
          addRecord(candidateId, {
            title: value.desc || value.title || value.caption,
            description: value.desc || value.description || value.title || value.caption,
            author: value.author?.nickname || value.author?.name || value.nickname || value.author_name,
            coverUrl,
            duration,
            publishedAt: value.create_time_text || value.publish_time_text || value.time_text,
          });
        }
        for (const child of Object.values(value)) {
          if (child && typeof child === 'object') queue.push(child);
        }
      }
    }
  };
  const collect = () => {
    let added = 0;
    const anchors = document.querySelectorAll(
      'a[href*="/video/"], a[href*="modal_id="], a[href*="aweme_id="], a[data-aweme-id], a[data-video-id]'
    );
    for (const anchor of anchors) {
      const videoId = videoIdFromElement(anchor);
      if (!videoId) continue;
      const card = findCard(anchor);
      const descriptionNode = card.querySelector?.(
        '[data-e2e*="search-card-desc"], [data-e2e*="video-desc"], [data-e2e*="desc"], [class*="title"], [class*="desc"]'
      );
      const lines = String(card.innerText || '').split(/\\n+/).map(compact).filter(Boolean);
      const fallbackTitle = bestTitleFromLines(lines);
      const title = compact(
        anchor.getAttribute('title') || anchor.getAttribute('aria-label') ||
        descriptionNode?.textContent || fallbackTitle
      );
      const authorNode = card.querySelector?.(
        'a[href*="/user/"], [data-e2e*="author"], [class*="author"]'
      );
      const visual = card.querySelector?.('img[src], img[data-src], video[poster]');
      const duration = lines.find(isDuration) || '';
      const publishedAt = lines.find(isPublishedAt) || '';
      const authorLine = lines.find((line) => line.startsWith('@')) || '';
      if (addRecord(videoId, {
        title,
        description: title,
        author: compact(authorNode?.textContent) || authorLine,
        coverUrl: usableImage(visual) || backgroundImage(card),
        duration,
        publishedAt,
      })) added += 1;
    }
    // Keep the visible DOM order authoritative. Hydration JSON is only a
    // fallback for cards whose current markup no longer exposes all fields.
    collectJsonRecords();
    return added;
  };

  const getScrollRoots = () => {
    const roots = [];
    const add = (element) => {
      if (!element || roots.includes(element)) return;
      if (element === document.scrollingElement) {
        roots.push(element);
        return;
      }
      const style = getComputedStyle(element);
      if (
        element.scrollHeight > element.clientHeight + 80 &&
        /^(?:auto|scroll|overlay)$/.test(style.overflowY)
      ) roots.push(element);
    };
    add(document.scrollingElement || document.documentElement);
    for (const element of document.querySelectorAll(
      'main, [role="main"], [data-e2e*="search"], [data-e2e*="feed"], ' +
      '[class*="scroll"], [class*="Scroll"], [class*="feed"], [class*="Feed"], ' +
      '[style*="overflow"]'
    )) add(element);
    // Douyin occasionally moves the feed into a generated wrapper whose class
    // name has no stable semantic token. Probe only viewport-sized overflow
    // candidates so the real scroll root is still found without walking style
    // information for every card descendant.
    for (const element of document.querySelectorAll('body *')) {
      if (
        element.clientHeight >= 240 &&
        element.clientWidth >= Math.max(320, window.innerWidth * 0.35) &&
        element.scrollHeight > element.clientHeight + 80
      ) add(element);
    }
    return roots;
  };
  const readScrollState = (roots) => roots.map((element) => ({
    element,
    top: element.scrollTop,
    height: element.scrollHeight,
    client: element.clientHeight,
  }));
  const setScrollTop = (element, top) => {
    try { element.scrollTo({ top, behavior: 'instant' }); }
    catch { element.scrollTop = top; }
  };
  const scrollToEnd = (roots) => {
    for (const element of roots) {
      setScrollTop(element, element.scrollHeight);
    }
    try { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); }
    catch { window.scrollTo(0, document.documentElement.scrollHeight); }
  };
  const getBottomTargets = () => {
    const targets = [];
    const add = (element) => {
      if (element && !targets.includes(element)) targets.push(element);
    };
    const anchors = Array.from(document.querySelectorAll(
      'a[href*="/video/"], a[href*="modal_id="], a[href*="aweme_id="], a[data-aweme-id], a[data-video-id]'
    ));
    const lastAnchor = anchors[anchors.length - 1];
    add(lastAnchor?.closest?.('li, article, [data-e2e*="search-card"], [data-e2e*="video-card"]') || lastAnchor);
    for (const element of document.querySelectorAll(
      '[data-e2e*="load-more"], [data-e2e*="loading"], [class*="loadMore"], [class*="load-more"], [class*="LoadMore"]'
    )) add(element);
    return targets;
  };
  const stimulateContinuousLoad = async (roots) => {
    const state = readScrollState(roots);
    const alreadyAtEnd = state.some((entry) =>
      entry.top + entry.client >= entry.height - 8 && entry.height > entry.client
    );
    // Infinite feeds commonly observe a bottom sentinel. Once a batch is
    // appended the old sentinel may stay intersecting, so briefly leave the
    // bottom before returning to it to create a fresh intersection/scroll.
    if (alreadyAtEnd) {
      for (const entry of state) {
        const maximum = Math.max(0, entry.height - entry.client);
        const nudge = Math.max(96, Math.min(520, entry.client * 0.55));
        if (maximum > 0) setScrollTop(entry.element, Math.max(0, maximum - nudge));
      }
      const documentRoot = document.scrollingElement || document.documentElement;
      const documentMaximum = Math.max(0, documentRoot.scrollHeight - window.innerHeight);
      if (documentMaximum > 0) window.scrollTo(0, Math.max(0, documentMaximum - 180));
      // The search BrowserWindow is hidden, so requestAnimationFrame may be
      // throttled. A short timer still lets native scroll/intersection events
      // run without depending on a visible renderer frame.
      await pause(90);
    }
    for (const target of getBottomTargets()) {
      try { target.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' }); }
      catch { target.scrollIntoView?.(false); }
    }
    scrollToEnd(getScrollRoots());
    await pause(50);
  };
  const waitForNewUniqueItems = (beforeSize, timeoutMs) => new Promise((done) => {
    let settled = false;
    const finish = (grew, blockingState = null) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      observer.disconnect();
      done({ grew, blockingState });
    };
    const check = () => {
      const blockingState = readBlockingState();
      if (blockingState.loginRequired || blockingState.verificationRequired) {
        finish(false, blockingState);
        return;
      }
      collect();
      if (memory.size > beforeSize) finish(true);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'poster', 'data-aweme-id', 'data-video-id'],
    });
    const interval = setInterval(check, 120);
    const timeout = setTimeout(() => finish(false), timeoutMs);
  });

  const hasExplicitEndMarker = () => {
    const markerText = /^(?:没有更多了|暂时没有更多了|已加载全部|全部加载完成|已经到底了)$/;
    return Array.from(document.querySelectorAll(
      '[data-e2e="search-no-more"], [data-e2e="search-load-end"]'
    )).some((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        element.getClientRects().length > 0 && markerText.test(compact(element.textContent));
    });
  };
  const hasVisibleLoadingIndicator = () => Array.from(document.querySelectorAll(
    '[data-e2e*="load-more"], [data-e2e*="loading"], [aria-busy="true"], ' +
    '[class*="loadMore"], [class*="load-more"], [class*="LoadMore"], ' +
    '[class*="loading"], [class*="Loading"]'
  )).some((element) => {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    const nearViewport = rect.bottom >= -16 && rect.top <= window.innerHeight + 16;
    return nearViewport && !/没有更多|已加载全部|已经到底/.test(
      compact(element.textContent)
    );
  });
  let idleRounds = 0;
  let stableBottomRounds = 0;
  let rounds = 0;
  let settledTail = false;
  collect();
  for (; Date.now() < deadline && memory.size < targetCount; rounds += 1) {
    const blockingState = readBlockingState();
    if (blockingState.loginRequired || blockingState.verificationRequired) {
      resolve({
        ...blockingState,
        items: Array.from(memory.values()),
        hasMore: false,
        exhausted: false,
        incomplete: false,
        parserMismatch: false,
        rounds,
      });
      return;
    }
    if (hasExplicitEndMarker()) break;
    const beforeSize = memory.size;
    const roots = getScrollRoots();
    const beforeScrollState = readScrollState(roots);
    const remainingMs = Math.max(0, deadline - Date.now() - 180);
    if (remainingMs <= 0) break;
    // Later batches on the official continuous stream routinely arrive more
    // slowly than the first batches. Increase the wait after each idle round,
    // but keep every request bounded by the script deadline.
    const growthWaitMs = Math.min(6000, 2200 + idleRounds * 650, remainingMs);
    const growthPromise = waitForNewUniqueItems(beforeSize, growthWaitMs);
    await stimulateContinuousLoad(roots);
    const observation = await growthPromise;
    if (observation.blockingState) {
      resolve({
        ...observation.blockingState,
        items: Array.from(memory.values()),
        hasMore: false,
        exhausted: false,
        incomplete: false,
        parserMismatch: false,
        rounds: rounds + 1,
      });
      return;
    }
    collect();
    if (memory.size >= targetCount) break;
    const grew = observation.grew || memory.size > beforeSize;
    idleRounds = grew ? 0 : Math.min(8, idleRounds + 1);
    if (!grew) {
      const afterScrollState = readScrollState(getScrollRoots());
      const stableAtBottom = afterScrollState.some((entry) => {
        const before = beforeScrollState.find((candidate) => candidate.element === entry.element);
        const bottomSlack = Math.max(96, entry.client * 0.12);
        return Boolean(before) && Math.abs(before.height - entry.height) <= 1 &&
          entry.height > entry.client && entry.top + entry.client >= entry.height - bottomSlack;
      });
      const loadingVisible = hasVisibleLoadingIndicator();
      const pageHasSettledItems = memory.size > requestOffset;
      const cursorReachedKnownTail = requestOffset > 0 && memory.size === requestOffset;
      stableBottomRounds = stableAtBottom && !loadingVisible
        ? stableBottomRounds + 1
        : 0;
      // Two consecutive quiet rounds at the real scroll bottom, with an
      // unchanged height and no official loader, establish a soft terminal
      // batch. This closes 2/10-item tails in about five seconds without
      // mistaking one delayed or duplicate-only append for exhaustion.
      if (
        stableBottomRounds >= 2 &&
        (pageHasSettledItems || cursorReachedKnownTail)
      ) {
        settledTail = true;
        break;
      }
      // A blank/mismatched renderer gets a second bounded stimulation, then
      // returns retryable rather than holding the UI until the hard deadline.
      if (!loadingVisible && idleRounds >= 2 && stableBottomRounds === 0) break;
      await pause(160);
    } else {
      stableBottomRounds = 0;
    }
  }
  collect();
  const finalBlockingState = readBlockingState();
  if (finalBlockingState.loginRequired || finalBlockingState.verificationRequired) {
    resolve({
      ...finalBlockingState,
      items: Array.from(memory.values()),
      hasMore: false,
      exhausted: false,
      incomplete: false,
      parserMismatch: false,
      rounds,
    });
    return;
  }
  const likelyCardCount = document.querySelectorAll(
    'a[href*="/video/"], a[href*="modal_id="], [data-home-video-id], [data-e2e*="search-card"], [data-e2e*="video-card"]'
  ).length;
  const emptyState = memory.size === 0 &&
    /暂无搜索结果|没有找到相关|暂无相关视频/.test(compact(document.body?.innerText));
  const parserMismatch = memory.size === 0 && likelyCardCount > 0 && !emptyState;
  const reachedTarget = memory.size >= targetCount;
  // Official markers close the stream immediately. A short requested slice is
  // also terminal only after one bounded quiet interval with no visible
  // official loader; blank first-page documents remain retryable.
  const confirmedExhausted = emptyState || hasExplicitEndMarker() || settledTail;
  const incomplete = !reachedTarget && !confirmedExhausted && !parserMismatch;
  resolve({
    ...finalBlockingState,
    items: Array.from(memory.values()),
    hasMore: !confirmedExhausted,
    exhausted: confirmedExhausted,
    incomplete,
    parserMismatch,
    rounds,
  });
}))()
`
}

function detectImageExtension(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg'
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return '.png'
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp'
  }
  if (bytes.toString('ascii', 4, 12).includes('ftypavif')) return '.avif'
  return null
}

function partitionOf(sessionValue) {
  try {
    return typeof sessionValue?.getPartition === 'function'
      ? sessionValue.getPartition()
      : ''
  } catch {
    return ''
  }
}

function hardenDouyinPlayerWebPreferences(webPreferences, expectedSession = null) {
  if (!webPreferences || typeof webPreferences !== 'object') return
  Object.assign(webPreferences, {
    partition: DOUYIN_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    spellcheck: false,
    devTools: false,
    navigateOnDragDrop: false,
  })
  if (expectedSession) webPreferences.session = expectedSession
  else delete webPreferences.session
  delete webPreferences.preload
  delete webPreferences.preloadURL
}

function destroyGuest(guest) {
  if (!guest || guest.isDestroyed?.()) return
  try { guest.destroy?.() } catch { /* Guest may disappear during navigation. */ }
}

function installDouyinPlayerWebviewGuard(
  hostContents,
  expectedSession = null,
  { onOpenInteraction = null } = {},
) {
  if (!hostContents || typeof hostContents.on !== 'function') {
    throw new TypeError('Host webContents is required')
  }
  const pendingTargets = []
  let disposed = false

  const handleWillAttach = (event, webPreferences = {}, params = {}) => {
    const parameterPartition = String(params.partition ?? '')
    const preferencePartition = String(webPreferences.partition ?? '')
    if (
      parameterPartition !== DOUYIN_PARTITION &&
      preferencePartition !== DOUYIN_PARTITION
    ) return
    const suppliedSession = webPreferences.session
    hardenDouyinPlayerWebPreferences(webPreferences, expectedSession)
    const target = parseDouyinOfficialPlayerUrl(params.src)
    if (
      parameterPartition !== DOUYIN_PARTITION ||
      preferencePartition !== DOUYIN_PARTITION ||
      !target ||
      (expectedSession && suppliedSession && suppliedSession !== expectedSession) ||
      (expectedSession && webPreferences.session !== expectedSession) ||
      (!expectedSession && suppliedSession &&
        partitionOf(suppliedSession) !== DOUYIN_PARTITION)
    ) {
      event.preventDefault()
      return
    }
    pendingTargets.push(target)
  }

  const handleDidAttach = (_event, guest) => {
    const ownsSession = expectedSession
      ? guest?.session === expectedSession
      : partitionOf(guest?.session) === DOUYIN_PARTITION
    const target = pendingTargets.shift()
    if (!ownsSession || !target) {
      if (target) destroyGuest(guest)
      return
    }
    const isPlayerTarget = (value) => {
      const parsed = parseDouyinOfficialPlayerUrl(value)
      return parsed?.mediaId === target.mediaId
    }
    const isInteractionTarget = (value) => {
      const parsedUrl = parseSecureUrl(value)
      const parsedTarget = parseDouyinInteractionPopupUrl(value, target.mediaId)
      return Boolean(
        parsedTarget?.mediaId === target.mediaId &&
        parsedUrl?.hostname.toLowerCase() === DOUYIN_HOST &&
        parsedUrl.pathname === '/jingxuan'
      )
    }
    const isBareInteractionRoot = (value) => {
      const parsed = parseSecureUrl(value)
      return Boolean(
        parsed &&
        parsed.hostname.toLowerCase() === DOUYIN_HOST &&
        (parsed.pathname === '/jingxuan' || parsed.pathname === '/jingxuan/') &&
        !parsed.search &&
        !parsed.hash
      )
    }
    let mode = 'player'
    let navigationGeneration = 0
    let autoplayRetryTimer = null
    let autoplaySequence = 0
    let containedPlayerLayoutApplied = false
    let containedPlayerLayoutKey = null

    const stopAutoplayRetries = () => {
      autoplaySequence += 1
      if (autoplayRetryTimer) clearTimeout(autoplayRetryTimer)
      autoplayRetryTimer = null
    }
    const removeContainedPlayerLayout = () => {
      containedPlayerLayoutApplied = false
      const key = containedPlayerLayoutKey
      containedPlayerLayoutKey = null
      if (!key || typeof guest.removeInsertedCSS !== 'function') return
      void Promise.resolve(guest.removeInsertedCSS(key)).catch(() => undefined)
    }
    const enterMode = (nextMode) => {
      if (nextMode !== 'player' && nextMode !== 'interaction') return false
      if (mode === nextMode) return true
      mode = nextMode
      navigationGeneration += 1
      stopAutoplayRetries()
      if (nextMode === 'interaction') removeContainedPlayerLayout()
      return true
    }
    const loadMode = (nextMode, { defer = false } = {}) => {
      if (!enterMode(nextMode) || guest.isDestroyed?.()) return
      const generation = ++navigationGeneration
      const url = nextMode === 'interaction'
        ? createDouyinInteractionUrl(target.mediaId)
        : target.url
      const performLoad = () => {
        if (
          guest.isDestroyed?.() ||
          generation !== navigationGeneration ||
          mode !== nextMode
        ) return
        void Promise.resolve(guest.loadURL?.(url)).catch(() => undefined)
      }
      if (defer) setImmediate(performLoad)
      else performLoad()
    }
    const guardNavigation = (event, url, _inPlace, isMainFrame = true) => {
      if (isMainFrame === false) return
      if (isBareInteractionRoot(url) && mode === 'interaction') {
        event.preventDefault()
        loadMode('player')
        return
      }
      if (isPlayerTarget(url)) {
        enterMode('player')
        return
      }
      if (mode === 'interaction' && isInteractionTarget(url)) return
      event.preventDefault()
    }
    const enforceNavigation = (url) => {
      if (guest.isDestroyed?.()) return
      if (
        (mode === 'player' && isPlayerTarget(url)) ||
        (mode === 'interaction' && isInteractionTarget(url))
      ) return
      if (mode === 'interaction' && isBareInteractionRoot(url)) {
        loadMode('player')
        return
      }
      loadMode(mode)
    }
    const enforceMainNavigation = (_event, url) => enforceNavigation(url)
    const enforceInPageNavigation = (_event, url, isMainFrame = true) => {
      if (isMainFrame !== false) enforceNavigation(url)
    }
    guest.on?.('will-navigate', guardNavigation)
    guest.on?.('will-redirect', guardNavigation)
    guest.on?.('did-navigate', enforceMainNavigation)
    guest.on?.('did-navigate-in-page', enforceInPageNavigation)
    guest.on?.('will-attach-webview', (event) => event.preventDefault())
    guest.setWindowOpenHandler?.(({ url } = {}) => {
      const interaction = parseDouyinInteractionPopupUrl(url, target.mediaId)
      if (interaction && mode === 'player') {
        loadMode('interaction', { defer: true })
        if (typeof onOpenInteraction === 'function') {
          setImmediate(() => {
            try {
              void Promise.resolve(onOpenInteraction(interaction)).catch(() => undefined)
            } catch {
              // Inline navigation remains authoritative if an observer fails.
            }
          })
        }
      }
      return { action: 'deny' }
    })
    const startAutoplay = () => {
      stopAutoplayRetries()
      if (
        mode !== 'player' ||
        typeof guest.executeJavaScript !== 'function'
      ) return
      const sequence = autoplaySequence
      let attempts = 0
      const attempt = async () => {
        if (
          sequence !== autoplaySequence || guest.isDestroyed?.() ||
          mode !== 'player' ||
          !isPlayerTarget(guest.getURL?.() ?? target.url)
        ) return
        attempts += 1
        let playing = false
        try {
          playing = await guest.executeJavaScript(
            DOUYIN_PLAYER_AUTOPLAY_SCRIPT,
            true,
          ) === true
        } catch {
          playing = false
        }
        if (
          playing || attempts >= PLAYER_AUTOPLAY_MAX_ATTEMPTS ||
          sequence !== autoplaySequence
        ) return
        autoplayRetryTimer = setTimeout(attempt, PLAYER_AUTOPLAY_RETRY_MS)
      }
      void attempt()
    }
    const applyContainedPlayerLayout = () => {
      if (
        guest.isDestroyed?.() ||
        mode !== 'player' ||
        containedPlayerLayoutApplied
      ) return
      const currentUrl = guest.getURL?.()
      if (currentUrl && !isPlayerTarget(currentUrl)) return
      containedPlayerLayoutApplied = true
      const generation = navigationGeneration
      void Promise.resolve(
        guest.insertCSS?.(DOUYIN_PLAYER_CONTAIN_CSS, { cssOrigin: 'author' }),
      ).then((key) => {
        if (
          guest.isDestroyed?.() ||
          mode !== 'player' ||
          generation !== navigationGeneration
        ) {
          if (key && typeof guest.removeInsertedCSS === 'function') {
            void Promise.resolve(guest.removeInsertedCSS(key)).catch(() => undefined)
          }
          return
        }
        containedPlayerLayoutKey = key || null
      }).catch(() => {
        if (mode === 'player' && generation === navigationGeneration) {
          containedPlayerLayoutApplied = false
        }
      })
    }
    guest.on?.('did-start-navigation', (_event, url, _inPlace, isMainFrame = true) => {
      if (isMainFrame === false) return
      if (isPlayerTarget(url)) {
        removeContainedPlayerLayout()
        return
      }
      if (isInteractionTarget(url)) {
        stopAutoplayRetries()
        removeContainedPlayerLayout()
      }
    })
    guest.on?.('dom-ready', applyContainedPlayerLayout)
    guest.on?.('did-finish-load', applyContainedPlayerLayout)
    guest.on?.('dom-ready', startAutoplay)
    guest.on?.('did-finish-load', startAutoplay)
    guest.once?.('destroyed', stopAutoplayRetries)
    applyContainedPlayerLayout()
    startAutoplay()
  }

  hostContents.on('will-attach-webview', handleWillAttach)
  hostContents.on('did-attach-webview', handleDidAttach)
  return () => {
    if (disposed) return
    disposed = true
    pendingTargets.length = 0
    hostContents.removeListener?.('will-attach-webview', handleWillAttach)
    hostContents.removeListener?.('did-attach-webview', handleDidAttach)
  }
}

async function readBoundedBody(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error('Douyin cover exceeds the size limit')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error('Douyin cover has an invalid size')
  }
  return bytes
}

function createDouyinSessionManager({
  BrowserWindow,
  sessionModule,
  getParentWindow = () => null,
  cacheDirectory = null,
  onAuthStateChange = () => undefined,
} = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required')
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') {
    throw new TypeError('Electron session is required')
  }
  if (cacheDirectory !== null && (!path.isAbsolute(cacheDirectory))) {
    throw new TypeError('Douyin cover cache directory must be absolute')
  }

  const sharedSession = sessionModule.fromPartition(DOUYIN_PARTITION, { cache: true })
  const coverTasks = new Map()
  let loginWindow = null
  let interactionWindow = null
  let interactionMediaId = ''
  let verificationWindow = null
  let verificationPollTimer = null
  let verificationPollInFlight = false
  let searchWindow = null
  let loadedSearchQuery = ''
  let paginationQuery = ''
  let paginationOffsets = new Map()
  let searchQueue = Promise.resolve()
  let disposed = false
  let suppressAuthEmission = false
  let lastSignedIn = null

  const isLoginOrVerificationContents = (contents) => Boolean(
    (loginWindow && !loginWindow.isDestroyed?.() && loginWindow.webContents === contents) ||
    (verificationWindow && !verificationWindow.isDestroyed?.() &&
      verificationWindow.webContents === contents)
  )
  const allowFullscreen = (contents, permission, origin) => {
    const parsed = parseSecureUrl(origin)
    return permission === 'fullscreen' &&
      !isLoginOrVerificationContents(contents) &&
      parsed?.hostname.toLowerCase() === 'open.douyin.com'
  }
  sharedSession.setPermissionCheckHandler?.(
    (contents, permission, origin, details = {}) => allowFullscreen(
      contents,
      permission,
      origin || details.requestingUrl || details.embeddingOrigin,
    ),
  )
  sharedSession.setPermissionRequestHandler?.(
    (contents, permission, callback, details = {}) => callback(allowFullscreen(
      contents,
      permission,
      details.requestingUrl || details.embeddingOrigin,
    )),
  )

  const preventDownload = (event, item) => {
    event.preventDefault?.()
    item?.cancel?.()
  }
  sharedSession.on?.('will-download', preventDownload)

  async function flushSession() {
    await Promise.allSettled([
      sharedSession.cookies?.flushStore?.(),
      sharedSession.flushStorageData?.(),
    ])
  }

  async function getAuthState() {
    const cookies = await sharedSession.cookies.get({ url: `https://${DOUYIN_HOST}` })
    return {
      signedIn: cookies.some((cookie) =>
        DOUYIN_AUTH_COOKIE_NAMES.includes(cookie?.name) &&
        typeof cookie?.value === 'string' && cookie.value.length > 0
      ),
    }
  }

  async function emitAuthState(force = false) {
    if (disposed || suppressAuthEmission) return
    const state = await getAuthState()
    if (force || state.signedIn !== lastSignedIn) {
      lastSignedIn = state.signedIn
      onAuthStateChange(state)
    }
    if (state.signedIn && loginWindow && !loginWindow.isDestroyed?.()) {
      await flushSession()
      loginWindow.close()
    }
  }

  const handleCookieChanged = (_event, cookie) => {
    if (
      DOUYIN_AUTH_COOKIE_NAMES.includes(cookie?.name) &&
      /(^|\.)douyin\.com$/i.test(String(cookie?.domain ?? ''))
    ) {
      void emitAuthState().catch(() => undefined)
    }
  }
  sharedSession.cookies?.on?.('changed', handleCookieChanged)

  function focusWindow(windowInstance) {
    if (!windowInstance || windowInstance.isDestroyed?.()) return false
    if (windowInstance.isMinimized?.()) windowInstance.restore?.()
    windowInstance.show?.()
    windowInstance.focus?.()
    return true
  }

  function keepWindowed(windowInstance) {
    const forceWindowed = () => {
      if (windowInstance.isDestroyed?.()) return
      windowInstance.setKiosk?.(false)
      windowInstance.setSimpleFullScreen?.(false)
      windowInstance.setFullScreen?.(false)
    }
    windowInstance.setFullScreenable?.(false)
    forceWindowed()
    windowInstance.on?.('enter-full-screen', forceWindowed)
    windowInstance.webContents.on?.('enter-html-full-screen', forceWindowed)
  }

  function guardContents(contents, authMode = false) {
    const allowed = authMode
      ? isAllowedDouyinAuthNavigationUrl
      : (value) => {
          const parsed = parseSecureUrl(value)
          return parsed?.hostname.toLowerCase() === DOUYIN_HOST
        }
    const guardNavigation = (event, value) => {
      if (!allowed(value)) event.preventDefault()
    }
    contents.on?.('will-navigate', guardNavigation)
    contents.on?.('will-redirect', guardNavigation)
    contents.on?.('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(({ url }) => {
      if (authMode && allowed(url)) {
        setImmediate(() => {
          if (!contents.isDestroyed?.()) void contents.loadURL?.(url).catch?.(() => undefined)
        })
      }
      return { action: 'deny' }
    })
  }

  function guardInteractionContents(contents, mediaId) {
    const isExpectedVideo = (value) => (
      parseDouyinInteractionPopupUrl(value, mediaId)?.mediaId === mediaId
    )
    const guardNavigation = (event, value) => {
      if (!isExpectedVideo(value)) event.preventDefault()
    }
    const enforceNavigation = (_event, value, _httpResponseCode, _httpStatusText) => {
      if (isExpectedVideo(value) || contents.isDestroyed?.()) return
      void Promise.resolve(contents.loadURL?.(createDouyinInteractionUrl(mediaId)))
        .catch(() => undefined)
    }
    contents.on?.('will-navigate', guardNavigation)
    contents.on?.('will-redirect', guardNavigation)
    contents.on?.('did-navigate', enforceNavigation)
    contents.on?.('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  }

  async function openLogin() {
    if (disposed) throw new Error('Douyin session manager is disposed')
    if (focusWindow(loginWindow)) return getAuthState()
    const parent = getParentWindow?.()
    loginWindow = new BrowserWindow({
      width: 620,
      height: 760,
      minWidth: 520,
      minHeight: 640,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      frame: true,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: '登录抖音',
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    const target = loginWindow
    guardContents(target.webContents, true)
    keepWindowed(target)
    target.webContents.on?.('did-finish-load', () => {
      void emitAuthState().catch(() => undefined)
      // Open the official login surface if the home page did not do so itself.
      void target.webContents.executeJavaScript?.(`
        (() => {
          const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
          const login = candidates.find((element) =>
            String(element.textContent || '').replace(/\\s+/g, '') === '登录'
          );
          if (login && typeof login.click === 'function') login.click();
        })()
      `, true).catch?.(() => undefined)
    })
    target.once?.('ready-to-show', () => target.show?.())
    target.once?.('closed', () => {
      if (loginWindow === target) loginWindow = null
      void flushSession()
    })
    await target.loadURL(DOUYIN_LOGIN_URL)
    target.show?.()
    return getAuthState()
  }

  async function openInteraction(request = {}) {
    if (disposed) throw new Error('Douyin session manager is disposed')
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('A Douyin interaction request is required')
    }
    if (Object.keys(request).some((key) => !['kind', 'mediaId'].includes(key))) {
      throw new TypeError('Only a Douyin interaction kind and media ID are accepted')
    }
    if (request.kind !== 'video') {
      throw new TypeError('Douyin interactions currently support videos only')
    }
    const mediaId = normalizeDouyinVideoId(request.mediaId)
    if (!mediaId) throw new TypeError('A valid Douyin video ID is required')

    if (
      interactionWindow && !interactionWindow.isDestroyed?.() &&
      interactionMediaId === mediaId
    ) {
      focusWindow(interactionWindow)
      return { opened: true, reason: null }
    }
    if (interactionWindow && !interactionWindow.isDestroyed?.()) {
      interactionWindow.close()
    }

    const parent = getParentWindow?.()
    interactionWindow = new BrowserWindow({
      width: 1080,
      height: 820,
      minWidth: 820,
      minHeight: 640,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      frame: true,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: '抖音互动',
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    interactionMediaId = mediaId
    const target = interactionWindow
    guardInteractionContents(target.webContents, mediaId)
    keepWindowed(target)
    target.setMenuBarVisibility?.(false)
    target.once?.('ready-to-show', () => target.show?.())
    target.once?.('closed', () => {
      if (interactionWindow === target) {
        interactionWindow = null
        interactionMediaId = ''
      }
      void flushSession()
    })
    try {
      await target.loadURL(createDouyinInteractionUrl(mediaId))
    } catch (error) {
      if (!target.isDestroyed?.()) target.close()
      throw error
    }
    target.show?.()
    target.focus?.()
    return { opened: true, reason: null }
  }

  async function openVerification(searchUrl) {
    if (focusWindow(verificationWindow)) return
    const parent = getParentWindow?.()
    verificationWindow = new BrowserWindow({
      width: 980,
      height: 780,
      minWidth: 720,
      minHeight: 600,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      frame: true,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: '完成抖音浏览器验证',
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    const target = verificationWindow
    guardContents(target.webContents, true)
    keepWindowed(target)
    const stopVerificationPolling = () => {
      if (verificationPollTimer) clearInterval(verificationPollTimer)
      verificationPollTimer = null
      verificationPollInFlight = false
    }
    const checkResolved = async () => {
      if (
        verificationPollInFlight || verificationWindow !== target ||
        target.isDestroyed?.() ||
        typeof target.webContents.executeJavaScript !== 'function'
      ) return
      verificationPollInFlight = true
      try {
        const resolved = await target.webContents.executeJavaScript(
          READ_DOUYIN_VERIFICATION_RESOLVED_SCRIPT,
          true,
        )
        if (resolved === true && verificationWindow === target && !target.isDestroyed?.()) {
          await flushSession()
          target.close()
        }
      } catch {
        // Keep the normal framed window manually closable if detection fails.
      } finally {
        verificationPollInFlight = false
      }
    }
    verificationPollTimer = setInterval(() => {
      void checkResolved()
    }, VERIFICATION_POLL_MS)
    verificationPollTimer.unref?.()
    target.once?.('ready-to-show', () => target.show?.())
    target.once?.('closed', () => {
      stopVerificationPolling()
      if (verificationWindow === target) verificationWindow = null
      void flushSession()
    })
    await target.loadURL(searchUrl)
    target.show?.()
  }

  function closeSearchWindow() {
    const target = searchWindow
    searchWindow = null
    loadedSearchQuery = ''
    if (target && !target.isDestroyed?.()) {
      if (typeof target.destroy === 'function') target.destroy()
      else target.close?.()
    }
  }

  function getSearchWindow() {
    if (searchWindow && !searchWindow.isDestroyed?.()) return searchWindow
    // Keep one bounded, hidden official search page warm so infinite-scroll state
    // survives between append-page requests without creating extra windows.
    searchWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      frame: false,
      backgroundColor: '#080b11',
      webPreferences: {
        session: sharedSession,
        backgroundThrottling: false,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    const target = searchWindow
    guardContents(target.webContents, false)
    target.setMenuBarVisibility?.(false)
    target.once?.('closed', () => {
      if (searchWindow === target) {
        searchWindow = null
        loadedSearchQuery = ''
      }
    })
    return target
  }

  async function cacheCover(value) {
    const coverUrl = normalizeDouyinCoverUrl(value)
    if (!coverUrl || !cacheDirectory || typeof sharedSession.fetch !== 'function') return null
    if (coverTasks.has(coverUrl)) return coverTasks.get(coverUrl)
    const task = (async () => {
      await fs.mkdir(cacheDirectory, { recursive: true })
      const key = crypto.createHash('sha256').update(coverUrl).digest('hex')
      for (const extension of IMAGE_CONTENT_TYPES.values()) {
        const existing = path.join(cacheDirectory, `${key}${extension}`)
        try {
          await fs.access(existing)
          return existing
        } catch {
          // Continue with the other known extensions before downloading.
        }
      }
      let currentUrl = coverUrl
      for (let redirects = 0; redirects <= 2; redirects += 1) {
        const response = await sharedSession.fetch(currentUrl, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          headers: {
            Accept: 'image/avif,image/webp,image/png,image/jpeg',
            Referer: `https://${DOUYIN_HOST}/`,
          },
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get?.('location')
          const next = location
            ? normalizeDouyinCoverUrl(new URL(location, currentUrl).toString())
            : null
          if (!next) throw new Error('Douyin cover redirect was rejected')
          currentUrl = next
          continue
        }
        if (!response.ok) throw new Error(`Douyin cover failed with status ${response.status}`)
        const contentType = String(response.headers?.get?.('content-type') ?? '')
          .split(';', 1)[0].trim().toLowerCase()
        if (!IMAGE_CONTENT_TYPES.has(contentType) && !GENERIC_IMAGE_TYPES.has(contentType)) {
          throw new Error('Douyin cover type is invalid')
        }
        const bytes = await readBoundedBody(response, MAX_COVER_BYTES)
        const extension = detectImageExtension(bytes)
        if (!extension) throw new Error('Douyin cover signature is invalid')
        const destination = path.join(cacheDirectory, `${key}${extension}`)
        const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        try {
          await fs.rename(temporary, destination)
        } catch (error) {
          await fs.rm(temporary, { force: true })
          if (error?.code !== 'EEXIST') throw error
        }
        return destination
      }
      throw new Error('Douyin cover redirected too many times')
    })().catch(() => null).finally(() => coverTasks.delete(coverUrl))
    coverTasks.set(coverUrl, task)
    return task
  }

  async function performSearch({ query, page, limit }) {
    if (disposed) throw new Error('Douyin session manager is disposed')
    const authState = await getAuthState()
    if (!authState.signedIn) {
      throw new DouyinSearchError(
        '请先登录抖音，再搜索视频。',
        'DOUYIN_LOGIN_REQUIRED',
        false,
      )
    }
    const target = getSearchWindow()
    const startsNewPagination = paginationQuery !== query || page === 1
    if (startsNewPagination) {
      paginationQuery = query
      paginationOffsets = new Map([[1, 0]])
    }
    const offset = paginationOffsets.get(page) ?? ((page - 1) * limit)
    if (loadedSearchQuery !== query || startsNewPagination) {
      await target.loadURL(createDouyinSearchUrl(query))
      loadedSearchQuery = query
    }
    const script = createDouyinPageSearchScript({ page, limit, offset })
    let timeoutId
    try {
      const timeout = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new DouyinSearchError(
          '抖音搜索响应超时，请稍后重试。',
          'DOUYIN_SEARCH_TIMEOUT',
          true,
        )), SEARCH_TIMEOUT_MS)
      })
      const payload = await Promise.race([
        target.webContents.executeJavaScript(script, true),
        timeout,
      ])
      const normalized = normalizeDouyinSearchPayload(payload, {
        query,
        page,
        limit,
        offset,
        allowPartial: true,
      })
      if (normalized.nextPage !== null) {
        paginationOffsets.set(normalized.nextPage, offset + normalized.results.length)
      }
      const results = await Promise.all(normalized.results.map(async (item) => ({
        ...item,
        thumbnailPath: await cacheCover(item.coverUrl),
      })))
      return { ...normalized, results }
    } catch (error) {
      if (error instanceof DouyinSearchError) {
        if (error.code === 'DOUYIN_VERIFICATION_REQUIRED') {
          closeSearchWindow()
          void openVerification(createDouyinSearchUrl(query)).catch(() => undefined)
        }
        throw error
      }
      closeSearchWindow()
      throw new DouyinSearchError(
        '抖音搜索暂时不可用，请稍后重试。',
        'DOUYIN_SEARCH_UNAVAILABLE',
        true,
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  function searchVideos(request = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('A Douyin search request is required')
    }
    if (Object.keys(request).some((key) => !['query', 'page', 'limit', 'searchType'].includes(key))) {
      throw new TypeError('Only a Douyin query, page, limit, and search type are accepted')
    }
    const query = normalizeQuery(request.query)
    const page = normalizePage(request.page)
    const limit = normalizeLimit(request.limit)
    if (request.searchType !== undefined && !['all', 'video'].includes(request.searchType)) {
      throw new TypeError('Douyin currently supports video search only')
    }
    const operation = searchQueue.then(() => performSearch({ query, page, limit }))
    searchQueue = operation.catch(() => undefined)
    return operation
  }

  function closeWindows() {
    closeSearchWindow()
    paginationQuery = ''
    paginationOffsets = new Map()
    if (interactionWindow && !interactionWindow.isDestroyed?.()) {
      interactionWindow.close()
    }
    interactionWindow = null
    interactionMediaId = ''
    if (loginWindow && !loginWindow.isDestroyed?.()) loginWindow.close()
    loginWindow = null
    if (verificationWindow && !verificationWindow.isDestroyed?.()) {
      verificationWindow.close()
    }
    verificationWindow = null
    if (verificationPollTimer) clearInterval(verificationPollTimer)
    verificationPollTimer = null
    verificationPollInFlight = false
  }

  async function logout() {
    suppressAuthEmission = true
    try {
      closeWindows()
      await sharedSession.closeAllConnections?.()
      if (typeof sharedSession.clearData === 'function') await sharedSession.clearData()
      else {
        await sharedSession.clearStorageData?.()
        await sharedSession.clearCache?.()
      }
      await flushSession()
    } finally {
      suppressAuthEmission = false
    }
    lastSignedIn = false
    const state = { signedIn: false }
    onAuthStateChange(state)
    return state
  }

  return {
    closeWindows,
    dispose() {
      if (disposed) return
      disposed = true
      closeWindows()
      sharedSession.cookies?.removeListener?.('changed', handleCookieChanged)
      sharedSession.removeListener?.('will-download', preventDownload)
      void flushSession()
    },
    flushSession,
    getAuthState,
    logout,
    openInteraction,
    openLogin,
    searchVideos,
  }
}

module.exports = {
  DOUYIN_AUTH_COOKIE_NAMES,
  DOUYIN_LOGIN_URL,
  DOUYIN_PARTITION,
  DOUYIN_PLAYER_AUTOPLAY_SCRIPT,
  DOUYIN_PLAYER_CONTAIN_CSS,
  READ_DOUYIN_VERIFICATION_RESOLVED_SCRIPT,
  DouyinSearchError,
  createDouyinInteractionUrl,
  createDouyinOfficialPlayerUrl,
  createDouyinPageSearchScript,
  createDouyinSearchUrl,
  createDouyinSessionManager,
  createDouyinVideoUrl,
  hardenDouyinPlayerWebPreferences,
  installDouyinPlayerWebviewGuard,
  isAllowedDouyinAuthNavigationUrl,
  normalizeDouyinCoverUrl,
  normalizeDouyinSearchPayload,
  parseDouyinOfficialPlayerUrl,
  parseDouyinInteractionPopupUrl,
  parseDouyinVideoUrl,
}
