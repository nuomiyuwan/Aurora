import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import './AppUpdatePrompt.css'

type AppUpdatePromptProps = {
  open: boolean
  state: AppUpdateState
  onClose: () => void
  onUpdate: () => void
}

const BUSY_STATUSES = new Set<AppUpdateStatus>([
  'downloading',
  'downloaded',
  'installing',
])

function formatReleaseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function actionLabel(state: AppUpdateState) {
  if (state.status === 'downloading') {
    return `正在下载 ${Math.round(state.progress ?? 0)}%`
  }
  if (state.status === 'downloaded') return '正在准备安装…'
  if (state.status === 'installing') return '正在重启 Aurora…'
  if (state.status === 'error') return '重新下载'
  return '更新并重启'
}

export function AppUpdatePrompt({
  open,
  state,
  onClose,
  onUpdate,
}: AppUpdatePromptProps) {
  const updateButtonRef = useRef<HTMLButtonElement>(null)
  const busy = BUSY_STATUSES.has(state.status)
  const releaseDate = useMemo(
    () => formatReleaseDate(state.releaseDate),
    [state.releaseDate],
  )

  useEffect(() => {
    if (!open) return
    updateButtonRef.current?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  const targetVersion = state.latestVersion ?? state.currentVersion
  const notes = state.releaseNotes.length > 0
    ? state.releaseNotes
    : ['本次更新未提供详细说明。']

  return createPortal(
    <div
      className="appUpdateOverlay"
      role="presentation"
      data-busy={busy || undefined}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        className="appUpdatePrompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        aria-describedby="app-update-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          className="appUpdateClose"
          type="button"
          aria-label="稍后更新"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.45} />
        </button>

        <header className="appUpdateHeader">
          <span className="appUpdateIcon" aria-hidden="true">
            <Sparkles size={20} strokeWidth={1.35} />
          </span>
          <span className="appUpdateEyebrow">Software Update</span>
          <h2 id="app-update-title">Aurora 有新版本</h2>
          <p id="app-update-description">
            后台下载完成后，Aurora 会自动重启并保留当前项目与设置。
          </p>
        </header>

        <div className="appUpdateVersions" aria-label="版本变化">
          <span>
            <small>当前版本</small>
            <strong>v{state.currentVersion}</strong>
          </span>
          <i aria-hidden="true">→</i>
          <span>
            <small>新版本</small>
            <strong>v{targetVersion}</strong>
          </span>
        </div>

        <section className="appUpdateNotes" aria-label="更新内容">
          <div>
            <h3>更新内容</h3>
            {releaseDate && <time dateTime={state.releaseDate ?? undefined}>{releaseDate}</time>}
          </div>
          <ul>
            {notes.map((note, index) => (
              <li key={`${index}:${note}`}>{note}</li>
            ))}
          </ul>
        </section>

        {(state.status === 'downloading' ||
          state.status === 'downloaded' ||
          state.status === 'installing') && (
          <div
            className="appUpdateProgress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress ?? 0)}
          >
            <span style={{ width: `${Math.round(state.progress ?? 0)}%` }} />
          </div>
        )}

        {state.status === 'error' && state.error && (
          <p className="appUpdateError" role="alert">
            {state.error}
          </p>
        )}

        <footer className="appUpdateActions">
          <button
            type="button"
            className="appUpdateLater"
            disabled={busy}
            onClick={onClose}
          >
            稍后
          </button>
          <button
            ref={updateButtonRef}
            type="button"
            className="appUpdatePrimary"
            disabled={busy}
            onClick={onUpdate}
          >
            {busy ? (
              <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Download size={15} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{actionLabel(state)}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
