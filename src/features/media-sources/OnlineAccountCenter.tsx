import { useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import {
  ONLINE_MEDIA_PROVIDER_IDS,
  ONLINE_PROVIDER_MANIFESTS,
  isOnlineMediaProvider,
  onlineProviderHasCapability,
  type OnlineMediaProvider,
  type OnlineProviderEnabledState,
} from '../../data/onlineProviderRegistry'

type ProviderAction = 'login' | 'logout'
type BusyAction = `${OnlineMediaProvider}:${ProviderAction}` | null

type AuthState = {
  supported: boolean
  signedIn: boolean
}

const SIGNED_OUT: AuthState = { supported: true, signedIn: false }

const PROVIDER_MESSAGES: Readonly<
  Record<OnlineMediaProvider, { signedIn: string; signedOut: string }>
> = {
  bilibili: {
    signedIn: '官方会话已连接，播放权益由 B站实时确认',
    signedOut: '登录后可使用当前账号的清晰度与会员权益',
  },
  tencent: {
    signedIn: '官方会话已连接，搜索与播放共用此账号',
    signedOut: '登录后可使用当前账号的会员播放权益',
  },
  xinpianchang: {
    signedIn: '官方会话已连接，搜索与播放共用此账号',
    signedOut: '登录后可使用当前账号的新片场权益',
  },
  youku: {
    signedIn: '官方会话已连接，播放权益由优酷实时确认',
    signedOut: '登录后可使用当前账号的清晰度与会员权益',
  },
}

const createInitialAuthStates = (): Record<OnlineMediaProvider, AuthState> =>
  Object.fromEntries(
    ONLINE_MEDIA_PROVIDER_IDS.map((provider) => [provider, SIGNED_OUT]),
  ) as Record<OnlineMediaProvider, AuthState>

const normalizeAuthState = (
  state: { supported?: boolean; signedIn: boolean },
): AuthState => ({
  supported: state.supported !== false,
  signedIn: Boolean(state.signedIn),
})

export type OnlineAccountCenterProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabledProviders: OnlineProviderEnabledState
  onProviderEnabledChange: (
    provider: OnlineMediaProvider,
    enabled: boolean,
  ) => void
}

export function OnlineAccountCenter({
  open,
  onOpenChange,
  enabledProviders,
  onProviderEnabledChange,
}: OnlineAccountCenterProps) {
  const bridge = window.desktopBridge
  const rootRef = useRef<HTMLDivElement>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [authStates, setAuthStates] = useState(createInitialAuthStates)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true

    const updateProvider = (
      provider: OnlineMediaProvider,
      state: { supported?: boolean; signedIn: boolean },
    ) => {
      if (!active) return
      setAuthStates((current) => ({
        ...current,
        [provider]: normalizeAuthState(state),
      }))
      setBusyAction((current) =>
        current?.startsWith(`${provider}:`) ? null : current,
      )
    }

    const accountProviders = ONLINE_MEDIA_PROVIDER_IDS.filter((provider) =>
      onlineProviderHasCapability(provider, 'account'),
    )

    if (bridge?.getOnlineProviderAuthState) {
      for (const provider of accountProviders) {
        void bridge.getOnlineProviderAuthState(provider)
          .then((state) => updateProvider(provider, state))
          .catch(() => undefined)
      }
    } else {
      if (bridge?.getBilibiliAuthState) {
        void bridge.getBilibiliAuthState()
          .then((state) => updateProvider('bilibili', state))
          .catch(() => undefined)
      }
      if (bridge?.getTencentVideoAuthState) {
        void bridge.getTencentVideoAuthState()
          .then((state) => updateProvider('tencent', state))
          .catch(() => undefined)
      }
    }

    const unsubscribeGeneric = bridge?.onOnlineProviderAuthStateChange?.(
      (provider, state) => {
        if (!isOnlineMediaProvider(provider)) return
        updateProvider(provider, state)
        const label = ONLINE_PROVIDER_MANIFESTS[provider].displayName
        setNotice(state.signedIn ? `${label}账号已连接` : `已退出${label}账号`)
      },
    )

    const unsubscribeBilibili = unsubscribeGeneric
      ? undefined
      : bridge?.onBilibiliAuthStateChange?.((state) => {
        updateProvider('bilibili', state)
        setNotice(state.signedIn ? 'B站账号已连接' : '已退出 B站账号')
      })
    const unsubscribeTencent = unsubscribeGeneric
      ? undefined
      : bridge?.onTencentVideoAuthStateChange?.((state) => {
        updateProvider('tencent', state)
        setNotice(state.signedIn ? '腾讯视频账号已连接' : '已退出腾讯视频账号')
      })

    return () => {
      active = false
      unsubscribeGeneric?.()
      unsubscribeBilibili?.()
      unsubscribeTencent?.()
    }
  }, [bridge])

  useEffect(() => {
    if (!open) return

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onOpenChange(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    document.addEventListener('pointerdown', closeFromOutside, true)
    window.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      window.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [onOpenChange, open])

  const getLegacyLogin = (provider: OnlineMediaProvider) => {
    if (provider === 'bilibili') return bridge?.openBilibiliLogin
    if (provider === 'tencent') return bridge?.openTencentVideoLogin
    return undefined
  }

  const getLegacyLogout = (provider: OnlineMediaProvider) => {
    if (provider === 'bilibili') return bridge?.logoutBilibili
    if (provider === 'tencent') return bridge?.logoutTencentVideo
    return undefined
  }

  const handleLogin = async (provider: OnlineMediaProvider) => {
    if (busyAction) return
    const label = ONLINE_PROVIDER_MANIFESTS[provider].displayName
    const openLogin = bridge?.openOnlineProviderLogin
      ? () => bridge.openOnlineProviderLogin(provider)
      : getLegacyLogin(provider)
    if (!openLogin) {
      setNotice('账号登录仅可在 Aurora 桌面版中使用')
      return
    }

    setBusyAction(`${provider}:login`)
    setNotice(`正在打开${label}官方登录页面…`)
    try {
      const state = normalizeAuthState(await openLogin())
      setAuthStates((current) => ({ ...current, [provider]: state }))
      setNotice(
        state.signedIn
          ? `${label}账号已连接`
          : state.supported
            ? '请在打开的官方页面完成登录'
            : `${label}暂不支持账号登录`,
      )
    } catch {
      setNotice('未能打开官方登录页面，请稍后重试')
    } finally {
      setBusyAction(null)
    }
  }

  const handleLogout = async (provider: OnlineMediaProvider) => {
    if (busyAction) return
    const label = ONLINE_PROVIDER_MANIFESTS[provider].displayName
    const logout = bridge?.logoutOnlineProvider
      ? () => bridge.logoutOnlineProvider(provider)
      : getLegacyLogout(provider)
    if (!logout) return

    setBusyAction(`${provider}:logout`)
    setNotice('正在清除 Aurora 内的账号会话…')
    try {
      const state = normalizeAuthState(await logout())
      setAuthStates((current) => ({ ...current, [provider]: state }))
      setNotice(`已退出${label}账号`)
    } catch {
      setNotice('退出失败，请稍后重试')
    } finally {
      setBusyAction(null)
    }
  }

  const signedInCount = ONLINE_MEDIA_PROVIDER_IDS.reduce(
    (count, provider) => count + Number(authStates[provider].signedIn),
    0,
  )

  return (
    <div
      ref={rootRef}
      className="onlineAccountCenter"
      data-open={open || undefined}
      data-signed-in={signedInCount > 0 || undefined}
      data-camera-gesture="block"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="onlineAccountTrigger"
        type="button"
        aria-label="账号与在线来源"
        title="账号与在线来源"
        aria-expanded={open}
        aria-controls="online-account-panel"
        onClick={() => {
          onOpenChange(!open)
          setNotice('')
        }}
      >
        <UserRound aria-hidden="true" size={19} strokeWidth={1.45} />
      </button>

      {open && (
        <aside
          id="online-account-panel"
          className="onlineAccountPanel uiGlassShell"
          aria-label="在线账号与来源管理"
        >
          <header className="onlineAccountHeader">
            <div>
              <p>ONLINE SOURCES</p>
              <h2>账号与在线来源</h2>
            </div>
            <button
              className="onlineAccountClose uiGlassInteractive"
              type="button"
              aria-label="关闭账号中心"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.45} />
            </button>
          </header>

          <div className="onlineAccountBody">
            {ONLINE_MEDIA_PROVIDER_IDS.map((providerId) => {
              const manifest = ONLINE_PROVIDER_MANIFESTS[providerId]
              const state = authStates[providerId]
              const enabled = enabledProviders[providerId]
              const supportsAccount = onlineProviderHasCapability(
                providerId,
                'account',
              )
              const busy = busyAction?.startsWith(`${providerId}:`) ?? false
              const message = PROVIDER_MESSAGES[providerId]
              return (
                <section
                  key={providerId}
                  className="onlineAccountProvider uiGlassInset"
                  data-provider={providerId}
                  data-connected={state.signedIn || undefined}
                  data-enabled={enabled || undefined}
                >
                  <span className="onlineAccountProviderMark" aria-hidden="true">
                    {manifest.shortLabel}
                  </span>
                  <span className="onlineAccountProviderCopy">
                    <strong>
                      {manifest.displayName}
                      {manifest.releaseStage === 'beta' && <em>BETA</em>}
                    </strong>
                    <small>
                      {supportsAccount && state.signedIn
                        ? message.signedIn
                        : message.signedOut}
                    </small>
                    <small className="onlineAccountProviderSearchState">
                      {enabled ? '已参与探索页搜索' : '未参与探索页搜索'}
                    </small>
                  </span>
                  <span className="onlineAccountProviderControls">
                    <button
                      className="onlineAccountProviderToggle"
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? '停用' : '启用'}${manifest.displayName}来源`}
                      title={enabled ? '关闭后不参与搜索，账号不会退出' : '开启此在线来源'}
                      onClick={() => {
                        onProviderEnabledChange(providerId, !enabled)
                        setNotice(
                          enabled
                            ? `已停用${manifest.displayName}来源；账号会话仍保留`
                            : `已启用${manifest.displayName}来源`,
                        )
                      }}
                    >
                      <span aria-hidden="true" />
                      <b>{enabled ? '已启用' : '未启用'}</b>
                    </button>

                    {supportsAccount && (
                      <button
                        className="onlineAccountProviderAction uiGlassInset uiGlassInteractive"
                        type="button"
                        disabled={busyAction !== null || !state.supported}
                        title={!state.supported ? '当前版本暂不支持此平台登录' : undefined}
                        onClick={() => void (
                          state.signedIn
                            ? handleLogout(providerId)
                            : handleLogin(providerId)
                        )}
                      >
                        {busy ? (
                          <RefreshCw className="isSpinning" aria-hidden="true" size={13} />
                        ) : state.signedIn ? (
                          <LogOut aria-hidden="true" size={13} strokeWidth={1.45} />
                        ) : (
                          <ExternalLink aria-hidden="true" size={13} strokeWidth={1.45} />
                        )}
                        <span>
                          {busy
                            ? '处理中'
                            : !state.supported
                              ? '暂不可用'
                              : state.signedIn
                                ? '退出'
                                : '登录'}
                        </span>
                      </button>
                    )}
                  </span>
                </section>
              )
            })}

            <p className="onlineAccountNotice" role="status" aria-live="polite">
              {notice || (
                <>
                  <ShieldCheck aria-hidden="true" size={12} strokeWidth={1.45} />
                  启用来源只控制搜索范围；关闭来源不会退出账号或清除会话。
                </>
              )}
            </p>
          </div>
        </aside>
      )}
    </div>
  )
}
