import { useEffect, useState } from 'react'
import {
  CircleUserRound,
  ExternalLink,
  Info,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { PageSettingsGlassBackdrop } from '../page-settings/PageSettingsGlassBackdrop'
import './EmbyConnectionPanel.css'

export type BilibiliConnectionPanelProps = {
  id?: string
  onClose?: () => void
  onConnectionChange?: (state: BilibiliAuthState) => void
}

type BusyAction = 'login' | 'logout' | null

const DISCONNECTED_STATE: BilibiliAuthState = { signedIn: false }

export function BilibiliConnectionPanel({
  id = 'bilibili-connection-panel',
  onClose,
  onConnectionChange,
}: BilibiliConnectionPanelProps) {
  const bridge = window.desktopBridge
  const bridgeAvailable = Boolean(bridge)
  const [authState, setAuthState] = useState<BilibiliAuthState>(
    DISCONNECTED_STATE,
  )
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [message, setMessage] = useState(
    bridgeAvailable
      ? '登录后，B站官方页面会按当前账号判断可播放权益。'
      : 'B站登录仅可在 Aurora 桌面版中使用。',
  )

  useEffect(() => {
    if (!bridge?.getBilibiliAuthState) return
    let active = true
    void bridge.getBilibiliAuthState().then((state) => {
      if (!active) return
      setAuthState(state)
      setMessage(
        state.signedIn
          ? '已登录；会员与清晰度权益将在播放时由 B站确认。'
          : '登录后，B站官方页面会按当前账号判断可播放权益。',
      )
    }).catch(() => {
      if (active) setMessage('暂时无法读取 B站登录状态。')
    })
    const unsubscribe = bridge.onBilibiliAuthStateChange?.((state) => {
      if (!active) return
      setAuthState(state)
      setBusyAction(null)
      setMessage(
        state.signedIn
          ? '已登录；会员与清晰度权益将在播放时由 B站确认。'
          : '已退出 B站账号。',
      )
      onConnectionChange?.(state)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [bridge, onConnectionChange])

  const handleLogin = async () => {
    if (!bridge?.openBilibiliLogin || busyAction) return
    setBusyAction('login')
    setMessage('正在打开 B站官方扫码登录页面…')
    try {
      const state = await bridge.openBilibiliLogin()
      setAuthState(state)
      setMessage(
        state.signedIn
          ? '已登录；会员与清晰度权益将在播放时由 B站确认。'
          : '请在打开的 B站官方页面完成扫码或网页登录。',
      )
      onConnectionChange?.(state)
    } catch {
      setMessage('未能打开 B站官方登录页面，请稍后重试。')
    } finally {
      setBusyAction(null)
    }
  }

  const handleLogout = async () => {
    if (!bridge?.logoutBilibili || busyAction) return
    setBusyAction('logout')
    setMessage('正在清除 Aurora 内的 B站会话…')
    try {
      const state = await bridge.logoutBilibili()
      setAuthState(state)
      setMessage('已退出；其他浏览器中的 B站账号不会受到影响。')
      onConnectionChange?.(state)
    } catch {
      setMessage('退出失败，请稍后重试。')
    } finally {
      setBusyAction(null)
    }
  }

  const signedIn = authState.signedIn

  return (
    <>
      <PageSettingsGlassBackdrop />
      <aside
        id={id}
        className="embyConnectionPanel bilibiliConnectionPanel pageSettingsPanel"
        data-camera-gesture="block"
        data-connection-status={signedIn ? 'connected' : 'disconnected'}
        aria-label="B站账号连接"
      >
        <header className="pageSettingsHeader">
          <div className="pageSettingsHeading">
            <CircleUserRound aria-hidden="true" size={16} strokeWidth={1.5} />
            <div>
              <p className="pageSettingsEyebrow">在线媒体</p>
              <h2>B站账号</h2>
            </div>
          </div>
          {onClose && (
            <button
              className="pageSettingsClose uiGlassInteractive"
              type="button"
              aria-label="关闭 B站账号面板"
              disabled={busyAction !== null}
              onClick={onClose}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.5} />
            </button>
          )}
        </header>

        <div className="pageSettingsBody">
          <section
            className="pageSettingsSection"
            aria-labelledby={`${id}-status`}
          >
            <div className="pageSettingsSectionTitle">
              <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id={`${id}-status`}>登录状态</h3>
            </div>
            <div
              className="embyConnectionStatus uiGlassInset"
              role="status"
              aria-live="polite"
            >
              <span className="embyConnectionStatusDot" aria-hidden="true" />
              <span>
                <strong>{signedIn ? '已登录' : '未登录'}</strong>
                <small>{message}</small>
              </span>
            </div>
            <dl className="embyConnectionSummary">
              <div>
                <dt>会话</dt>
                <dd>Aurora 独立 B站会话</dd>
              </div>
              <div>
                <dt>会员权益</dt>
                <dd>由 B站播放器实时判断</dd>
              </div>
            </dl>
          </section>

          {!signedIn && (
            <section
              className="pageSettingsSection"
              aria-labelledby={`${id}-login`}
            >
              <div className="pageSettingsSectionTitle">
                <CircleUserRound aria-hidden="true" size={15} strokeWidth={1.5} />
                <h3 id={`${id}-login`}>官方登录</h3>
              </div>
              <button
                className="embyConnectionAction pageSettingsBackgroundButton uiGlassInset uiGlassInteractive"
                type="button"
                disabled={!bridgeAvailable || busyAction !== null}
                onClick={() => void handleLogin()}
              >
                {busyAction === 'login' ? (
                  <RefreshCw
                    className="isSpinning"
                    aria-hidden="true"
                    size={14}
                    strokeWidth={1.5}
                  />
                ) : (
                  <ExternalLink aria-hidden="true" size={14} strokeWidth={1.5} />
                )}
                <span>{busyAction === 'login' ? '正在打开…' : '登录 B站'}</span>
              </button>
              <p className="embyConnectionPasswordNote">
                Aurora 只打开 B站官方扫码/网页登录，不接触或保存你的密码。
              </p>
            </section>
          )}

          <section
            className="pageSettingsSection"
            aria-labelledby={`${id}-scope`}
          >
            <div className="pageSettingsSectionTitle">
              <Info aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id={`${id}-scope`}>功能说明</h3>
            </div>
            <p className="embyConnectionDisclosure">
              搜索与播放均由 B站官方页面提供。Aurora 只保存链接、封面缩略图、收藏和项目引用；不会下载视频，也不会为在线视频建立帧环。
            </p>
          </section>
        </div>

        {signedIn && (
          <footer className="pageSettingsFooter">
            <button
              className="embyConnectionAction pageSettingsResetButton uiGlassInset uiGlassInteractive"
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleLogout()}
            >
              {busyAction === 'logout' ? (
                <RefreshCw
                  className="isSpinning"
                  aria-hidden="true"
                  size={14}
                  strokeWidth={1.5}
                />
              ) : (
                <LogOut aria-hidden="true" size={14} strokeWidth={1.5} />
              )}
              <span>{busyAction === 'logout' ? '正在退出…' : '退出 B站'}</span>
            </button>
          </footer>
        )}
      </aside>
    </>
  )
}
