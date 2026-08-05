import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Info,
  RefreshCw,
  Server,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react'
import {
  createRendererEmbyBridgeAdapter,
} from '../../integrations/emby'
import type {
  EmbyConnectionInput,
  EmbyConnectionState,
  EmbyRendererBridgeAdapter,
} from '../../integrations/emby'
import { PageSettingsGlassBackdrop } from '../page-settings/PageSettingsGlassBackdrop'
import './EmbyConnectionPanel.css'

export type EmbyConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export type EmbyConnectionPanelBridge = Pick<
  EmbyRendererBridgeAdapter,
  'getConnection' | 'testConnection' | 'disconnect'
>

export type EmbyConnectionPanelProps = {
  id?: string
  className?: string
  onClose?: () => void
  bridge?: EmbyConnectionPanelBridge | null
  initialConnection?: EmbyConnectionState | null
  autoLoad?: boolean
  onStatusChange?: (
    status: EmbyConnectionStatus,
    connection: EmbyConnectionState,
  ) => void
  onConnectionChange?: (connection: EmbyConnectionState) => void
  /**
   * When enabled, the host can keep the component in its settings tree while
   * limiting rendering to the Discovery page.
   */
  discoverySettingsOnly?: boolean
  isDiscoverySettingsActive?: boolean
}

type BusyAction = 'connect' | 'disconnect' | null

const DISCONNECTED_CONNECTION: EmbyConnectionState = {
  connected: false,
  serverUrl: null,
  serverId: null,
  serverName: null,
  user: null,
  connectedAt: null,
  persistence: 'none',
}

const STATUS_COPY: Record<
  EmbyConnectionStatus,
  {
    label: string
    detail: string
  }
> = {
  disconnected: {
    label: '未连接',
    detail: '输入你的 Emby 服务器信息以测试连接。',
  },
  connecting: {
    label: '连接中',
    detail: '正在验证服务器地址与用户权限…',
  },
  connected: {
    label: '已连接',
    detail: '媒体源已就绪，可在探索页中搜索。',
  },
  error: {
    label: '连接错误',
    detail: '未能连接媒体源，请检查服务器与账户信息。',
  },
}

const normalizeServerUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, '')
}

const validateServerUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

export function EmbyConnectionPanel({
  id = 'emby-connection-panel',
  className = '',
  onClose,
  bridge: bridgeOverride,
  initialConnection = null,
  autoLoad = true,
  onStatusChange,
  onConnectionChange,
  discoverySettingsOnly = false,
  isDiscoverySettingsActive = true,
}: EmbyConnectionPanelProps) {
  const bridge = useMemo(
    () =>
      bridgeOverride === undefined
        ? createRendererEmbyBridgeAdapter()
        : bridgeOverride,
    [bridgeOverride],
  )
  const [status, setStatus] = useState<EmbyConnectionStatus>(
    initialConnection?.connected ? 'connected' : 'disconnected',
  )
  const [connection, setConnection] = useState<EmbyConnectionState>(
    initialConnection ?? DISCONNECTED_CONNECTION,
  )
  const [serverUrl, setServerUrl] = useState(
    initialConnection?.serverUrl ?? '',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(
    initialConnection?.connected
      ? STATUS_COPY.connected.detail
      : STATUS_COPY.disconnected.detail,
  )
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const requestSequenceRef = useRef(0)

  useEffect(() => {
    onStatusChange?.(status, connection)
  }, [connection, onStatusChange, status])

  useEffect(() => {
    if (!autoLoad || initialConnection || !bridge) return

    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    let active = true

    void bridge
      .getConnection()
      .then((savedConnection) => {
        if (!active || requestSequenceRef.current !== sequence) return
        setConnection(savedConnection)
        if (!savedConnection.connected) {
          setStatus('disconnected')
          setMessage(STATUS_COPY.disconnected.detail)
          return
        }

        setServerUrl(savedConnection.serverUrl ?? '')
        setUsername(savedConnection.user?.name ?? '')
        setPassword('')
        setStatus('connected')
        setMessage(
          savedConnection.serverName
            ? `已连接到 ${savedConnection.serverName}`
            : STATUS_COPY.connected.detail,
        )
      })
      .catch((error: unknown) => {
        if (!active || requestSequenceRef.current !== sequence) return
        setStatus('error')
        setMessage(
          getErrorMessage(error, '无法读取已保存的 Emby 连接状态。'),
        )
      })

    return () => {
      active = false
    }
  }, [autoLoad, bridge, initialConnection])

  if (discoverySettingsOnly && !isDiscoverySettingsActive) return null

  const isBusy = busyAction !== null
  const bridgeAvailable = bridge !== null
  const isConnected = connection.connected

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!bridge || isBusy || isConnected) return

    const normalizedUrl = normalizeServerUrl(serverUrl)
    const normalizedUsername = username.trim()
    if (!validateServerUrl(normalizedUrl)) {
      setStatus('error')
      setMessage('请输入有效的 HTTP 或 HTTPS Emby 服务器地址。')
      return
    }
    if (!normalizedUsername) {
      setStatus('error')
      setMessage('请输入 Emby 用户名。')
      return
    }

    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    setBusyAction('connect')
    setStatus('connecting')
    setMessage(STATUS_COPY.connecting.detail)

    try {
      const input: EmbyConnectionInput = {
        serverUrl: normalizedUrl,
        username: normalizedUsername,
        password,
      }
      const result = await bridge.testConnection(input)
      if (requestSequenceRef.current !== sequence) return
      if (!result.connected) {
        setConnection(result)
        setStatus('error')
        setMessage(STATUS_COPY.error.detail)
        return
      }

      setConnection(result)
      setServerUrl(result.serverUrl ?? normalizedUrl)
      setUsername(result.user?.name ?? normalizedUsername)
      setPassword('')
      setStatus('connected')
      setMessage(
        result.serverName
          ? `已连接到 ${result.serverName}`
          : STATUS_COPY.connected.detail,
      )
      onConnectionChange?.(result)
    } catch (error: unknown) {
      if (requestSequenceRef.current !== sequence) return
      setStatus('error')
      setMessage(getErrorMessage(error, STATUS_COPY.error.detail))
    } finally {
      if (requestSequenceRef.current === sequence) {
        setBusyAction(null)
      }
    }
  }

  const handleDisconnect = async () => {
    if (!bridge || isBusy || !isConnected) return

    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    setBusyAction('disconnect')
    setMessage('正在断开 Emby 媒体源…')

    try {
      const result = await bridge.disconnect()
      if (requestSequenceRef.current !== sequence) return
      if (result.connected) {
        setConnection(result)
        setStatus('error')
        setMessage('无法断开 Emby 媒体源。')
        return
      }

      setConnection(result)
      setPassword('')
      setStatus('disconnected')
      setMessage(STATUS_COPY.disconnected.detail)
      onConnectionChange?.(result)
    } catch (error: unknown) {
      if (requestSequenceRef.current !== sequence) return
      setStatus('error')
      setMessage(getErrorMessage(error, '无法断开 Emby 媒体源。'))
    } finally {
      if (requestSequenceRef.current === sequence) {
        setBusyAction(null)
      }
    }
  }

  return (
    <>
      <PageSettingsGlassBackdrop />
      <aside
        id={id}
        className={[
          'embyConnectionPanel',
          'pageSettingsPanel',
          className,
        ].filter(Boolean).join(' ')}
        data-camera-gesture="block"
        data-connection-status={status}
        aria-label="Emby 媒体源连接"
      >
      <header className="pageSettingsHeader">
        <div className="pageSettingsHeading">
          <Server aria-hidden="true" size={16} strokeWidth={1.5} />
          <div>
            <p className="pageSettingsEyebrow">媒体源</p>
            <h2>连接 Emby</h2>
          </div>
        </div>
        {onClose && (
          <button
            className="pageSettingsClose uiGlassInteractive"
            type="button"
            aria-label="关闭 Emby 连接面板"
            disabled={isBusy}
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
            <h3 id={`${id}-status`}>连接状态</h3>
          </div>
          <div
            className="embyConnectionStatus uiGlassInset"
            role="status"
            aria-live="polite"
          >
            <span className="embyConnectionStatusDot" aria-hidden="true" />
            <span>
              <strong>{STATUS_COPY[status].label}</strong>
              <small>{message}</small>
            </span>
          </div>
          {connection && (
            <dl className="embyConnectionSummary">
              <div>
                <dt>服务器</dt>
                <dd>
                  {connection.serverName ?? connection.serverUrl ?? serverUrl}
                </dd>
              </div>
              <div>
                <dt>用户</dt>
                <dd>
                  {connection.user?.name || username || '已授权用户'}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <form noValidate onSubmit={handleConnect}>
          <section
            className="pageSettingsSection"
            aria-labelledby={`${id}-credentials`}
          >
            <div className="pageSettingsSectionTitle">
              <Server aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id={`${id}-credentials`}>服务器信息</h3>
            </div>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">服务器地址</span>
              <input
                className="pageSettingsTextInput"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="url"
                value={serverUrl}
                placeholder="http://192.168.1.20:8096"
                disabled={isBusy || isConnected}
                onChange={(event) => setServerUrl(event.currentTarget.value)}
              />
            </label>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">用户名</span>
              <input
                className="pageSettingsTextInput"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={username}
                placeholder="Emby 用户名"
                disabled={isBusy || isConnected}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </label>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">密码</span>
              <input
                className="pageSettingsTextInput"
                type="password"
                autoComplete="current-password"
                value={password}
                placeholder={isConnected ? '已安全验证' : 'Emby 密码'}
                disabled={isBusy || isConnected}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <p className="embyConnectionPasswordNote">
              密码只用于本次验证，不会保存。
            </p>

            {!isConnected && (
              <button
                className={[
                  'embyConnectionAction',
                  'pageSettingsBackgroundButton',
                  'uiGlassInset',
                  'uiGlassInteractive',
                ].join(' ')}
                type="submit"
                disabled={
                  isBusy ||
                  !bridgeAvailable ||
                  !serverUrl.trim() ||
                  !username.trim()
                }
              >
                <RefreshCw
                  className={busyAction === 'connect' ? 'isSpinning' : ''}
                  aria-hidden="true"
                  size={14}
                  strokeWidth={1.5}
                />
                <span>
                  {busyAction === 'connect' ? '正在连接…' : '测试并连接'}
                </span>
              </button>
            )}

            {!bridgeAvailable && (
              <p className="embyConnectionBridgeNote">
                Emby 连接服务暂时不可用。
              </p>
            )}
          </section>
        </form>

        <section
          className="pageSettingsSection"
          aria-labelledby={`${id}-scope`}
        >
          <div className="pageSettingsSectionTitle">
            <Info aria-hidden="true" size={15} strokeWidth={1.5} />
            <h3 id={`${id}-scope`}>功能说明</h3>
          </div>
          <p className="embyConnectionDisclosure">
            用于整理你有权访问的自有媒体。Aurora 不提供在线片源，不会下载原片；
            Emby 连接是免费且完全可选的功能。
          </p>
        </section>
      </div>

      {isConnected && (
        <footer className="pageSettingsFooter">
          <button
            className={[
              'embyConnectionAction',
              'pageSettingsResetButton',
              'uiGlassInset',
              'uiGlassInteractive',
            ].join(' ')}
            type="button"
            disabled={isBusy || !bridgeAvailable}
            onClick={() => void handleDisconnect()}
          >
            {busyAction === 'disconnect' ? (
              <RefreshCw
                className="isSpinning"
                aria-hidden="true"
                size={14}
                strokeWidth={1.5}
              />
            ) : (
              <Unplug aria-hidden="true" size={14} strokeWidth={1.5} />
            )}
            <span>
              {busyAction === 'disconnect' ? '正在断开…' : '断开连接'}
            </span>
          </button>
        </footer>
      )}
      </aside>
    </>
  )
}
