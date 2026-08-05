# Aurora 在线视频源接入协议

状态：核心 Provider 架构已代码化；平台能力仍按清单逐项验收
更新日期：2026-08-05

本文把 Aurora 已经在 B 站和腾讯视频接入中验证过的边界沉淀为可复用协议。当本文与运行代码冲突时，以用户最新要求和当前源码为权威。

## 1. 结论

Aurora 应当建立统一的 **Online Provider（在线源适配器）** 层，不再为每个网站重新复制探索页、卡片、详情、收藏、项目引用和播放页逻辑。

“在设置中填写网址后自动接入”可分为两种不同能力：

1. **粘贴单个视频页链接**：可以做得相当通用。Aurora 可尝试识别标题、封面、作者、视频类型和官方播放入口，再由用户确认收藏或加入项目。
2. **接入整个视频平台**：无法靠一个首页网址长期、全自动地推断出搜索、分页、会员、选集、清晰度和播放器规则。这类能力必须通过受审查的 Provider 适配器提供。

因此，推荐产品形态是“**通用链接识别 + 可扩展平台适配器**”，而不是让 Aurora 自动执行任意网站脚本。

## 2. 产品边界

### Aurora 负责

- 探索页搜索框、结果卡片、右侧详情、倒影和加载节奏。
- 在线内容的稳定 ID、收藏、标签、备注、项目引用和数量统计。
- 复用帧环页空间的官方在线播放框和底部操作。
- 通用的缓存、失败降级、诊断、权限告知和适配器能力判定。

### Provider 适配器负责

- 识别该站点的视频页、剧集页和稳定媒体 ID。
- 在声明支持时提供搜索、分页、选集、登录状态与官方播放入口。
- 将平台数据归一化成 Aurora 的标准描述符。
- 声明搜索、登录、播放、封面和导航所需的最小域名白名单。
- 在页面改版时通过契约测试暴露失效，不用空卡片或假按钮伪装成功。

### 明确不做

- 不下载、拆分、转码、重封装或保存在线视频流。
- 不为在线视频生成帧环或视觉索引。
- 不绕过 DRM、会员、地区、年龄或其他平台访问限制。
- 不读取、导出或同步用户密码和 Cookie。
- 不把未知网站的任意 JavaScript 作为 Aurora 扩展直接执行。

## 3. 能力分级

| 级别 | 能力 | Aurora 行为 |
| --- | --- | --- |
| Link | 识别单条公开链接和公开元数据 | 显示统一卡片；可收藏、加入项目或打开官方页 |
| Embed | Link + 可审查的官方内嵌播放 | 在 Aurora 帧环页播放；不生成帧环 |
| Search | Embed + 关键词搜索和真实分页 | 进入探索页来源筛选与统一结果流 |
| Account | Search + 独立登录会话、选集/清晰度由官方页面判定 | 在统一账户入口显示登录状态 |

能力必须通过注册表显式声明。UI 只显示适配器已实现的动作；不允许用点击后提示“尚未实现”的摆设按钮占位。

### 启用、登录与搜索参与

“是否启用平台”和“是否登录平台”是两种独立状态：

- **启用**决定该来源是否出现在探索页来源筛选、是否参与“全部来源”搜索、是否允许发起该 Provider 的网络请求。
- **登录**只表示对应官方会话是否已连接；关闭来源不退出账号，退出账号也不自动关闭来源。
- 账号中心是平台启用状态和登录状态的唯一管理入口；探索页只读取一致的 Provider Registry 快照，不另存一份开关。
- 已有 B 站和腾讯视频在迁移现有用户时保持启用；以后新增的平台默认关闭，由用户主动开启。
- 关闭来源时立即取消该来源尚未完成的搜索、清除本次查询中的临时结果并隐藏筛选项，但不删除收藏、项目引用、受管封面或该平台的独立登录会话。
- 开启来源后显示筛选项；若探索页已有查询，可只重新执行新启用来源并按稳定 ID 合并，不能让全部来源结果整页闪烁重建。
- “全部来源”只并行请求已启用来源，首屏采用平衡配额，避免单个平台占满九槽卡片；选定单一来源后才展示该平台的真实分页。
- Provider 失效或被紧急停用时，历史收藏与项目引用仍可查看，并按能力降级为受管封面和官方页面入口。

## 4. 统一 Provider 契约

下列是拟议契约，实际类型名可在实施时调整，但能力边界必须保留：

```ts
type OnlineProviderCapability =
  | 'resolve-url'
  | 'official-playback'
  | 'search'
  | 'pagination'
  | 'account'
  | 'episodes'
  | 'poster-capture'

interface OnlineProviderManifest {
  schemaVersion: 1
  id: string
  displayName: string
  adapterVersion: string
  releaseStage: 'stable' | 'beta' | 'link-only' | 'disabled'
  defaultEnabled: boolean
  capabilities: OnlineProviderCapability[]
  hosts: {
    pages: string[]
    api: string[]
    images: string[]
    auth: string[]
  }
  persistentSession: boolean
}

interface OnlineProviderAdapter {
  manifest: OnlineProviderManifest
  matchUrl(url: URL): boolean
  resolveUrl?(url: URL, signal?: AbortSignal): Promise<OnlineItem | null>
  search?(request: OnlineSearchRequest, signal?: AbortSignal): Promise<OnlineSearchPage>
  getAuthState?(): Promise<{ signedIn: boolean }>
  openLogin?(): Promise<{ signedIn: boolean }>
  logout?(): Promise<{ signedIn: boolean }>
  listEpisodes?(item: OnlineItem, signal?: AbortSignal): Promise<OnlineEpisode[]>
  createPlaybackTarget?(item: OnlineItem): OnlinePlaybackTarget | null
  capturePoster?(item: OnlineItem): Promise<string | null>
}
```

契约要求：

- Provider ID 是小写、稳定、不可复用的名称，用于会话分区、缓存和媒体稳定 ID。
- 媒体稳定 ID 优先使用平台 ID；通用链接源才使用规范化 URL 的哈希。
- 网络、Cookie、封面下载和页面安全策略属于主进程；React 只接收经过清洗的 DTO。
- Provider 不生成 JSX/CSS，不能改变 Aurora 的卡片、详情和播放页布局。
- 任一可选能力失败时，核心层仍能依据能力标记降级。

## 5. 标准数据模型

主进程输出给 Aurora 的每条在线结果至少包含：

- `provider`、`kind`、`mediaId`、`canonicalUrl`；剧集/专辑身份与当前播放单集身份不同时，另用可选 `playbackId`，不把它混入稳定资产 ID。
- `title`、`description`、`author`、`publishedAt`、`duration`、`tags`。
- 临时的远程 `coverUrl` 与可持久的受管本地 `thumbnailPath`。
- 可选的剧集/单集关系，但不保存过期的播放流地址。

`OnlineMediaProvider` 已迁移为由注册表验证的 B站、腾讯视频、新片场与优酷 Provider ID；新增来源仍必须先注册，不能放宽为任意未校验字符串。

全局稳定身份继续使用：

```text
asset:online:<provider>:<kind>:<mediaId>
```

收藏、标签、备注和项目引用都依赖该身份，不能依赖某次搜索返回的卡片顺序。

## 6. 搜索与封面

### 搜索

- 请求只从主进程发出，并且只访问 Manifest 声明的 API 域名。
- 必须支持取消、超时、限量、真实分页和稳定去重；不得用固定数量结果伪装分页。
- 返回文本要去标签、去控制字符、设长度上限，不把服务端 HTML 注入 React。
- 用 `provider + kind + mediaId` 去重，搜索页结果与资料库已收藏/已引用资产必须合并状态。
- 新搜索只在结果和必要视觉资源就绪后一次性显示，不回退到逐卡闪现。

### 封面

- 远程封面 URL 必须归一化为 HTTPS，且最终主机必须位于 Provider 声明的图片域名中。
- 跟随重定向时要重新校验协议、主机、端口和凭据，不能因起点合法就信任终点。
- 校验响应状态、MIME、实际字节数和图片解码；使用临时文件后原子替换。
- 远程 URL 不写入需长期显示的 UI 状态；缓存成功后只保存受管本地路径。
- 下载失败时保留结果并使用 Aurora 占位底图；诊断信息要区分“平台未给封面”、“域名被拒绝”、“网络失败”和“图片无法解码”。

## 7. 登录、会话与隐私

- 每个 Provider 使用独立持久分区，形如 `persist:aurora-online-<provider>-v1`；不共用 Aurora 主页会话。
- 登录只在该 Provider 的官方 HTTPS 页面中完成，不注入密码、不拦截表单、不读取 Cookie 内容给 renderer。
- renderer 只能获取 `{ signedIn: boolean }` 等最小状态。
- 登录窗口是可关闭的普通窗口，禁止网页或原生全屏；成功后持久化会话并自动关闭。
- 注销只清理当前 Provider 分区，不影响其他平台、本地资料库和 AI 配置。
- 会员、清晰度和可播权限由官方页面实时判定；Aurora 不伪造会员状态。

## 8. 官方播放与 WebView 安全

- 只接受 `https:` 的规范页面，禁止用户名/密码 URL、非必要端口、未声明主机、非法媒体 ID 和携带未审查查询参数的页面。
- `will-attach-webview` 与 `did-attach-webview` 双重校验 partition、src 和真实 Session 对象身份。
- 锁死 `contextIsolation`、`sandbox`、`nodeIntegration=no`、`webSecurity=yes`；禁止未审查的 preload。
- 导航、弹窗、下载、权限、外部协议和全屏需分开白名单处理。
- WebView 的命中区域只能覆盖视频框，不能用透明层截获 Aurora 导航、账户入口和底部操作。
- 站点 CSS/DOM 提取必须放在 Provider 内，不得污染 Aurora 全局样式。官方页面改版时应失败降级，不得扩大覆盖区域。
- 全屏前后 Aurora 的导航、播放控件、倒影和交互层必须恢复一致状态。
- 倒影优先使用受管封面或一次有效捕获；不保证 DRM/硬件受保护画面可捕获。捕获失败必须回退封面，不进入循环重载。

## 9. “填网址自动分析”流程

### 已知 Provider

1. 规范化 URL，只接受 HTTPS，并拒绝凭据、非标准端口和过长输入。已知 Provider 的官方 HTTP 链接只可在白名单主机上本地升级为 HTTPS，不先发出明文请求。
2. 由 Provider Registry 匹配主机与路径。
3. 调用已审查的 `resolveUrl`，得到稳定 ID 和标准描述符。
4. 展示分析结果和能力，经用户确认后再收藏、加入项目或播放。

### 未知 Provider

1. 默认不带 Cookie 、不执行页面脚本地请求公开元数据。
2. 仅在响应大小和超时上限内解析 `<title>`、Open Graph、JSON-LD `VideoObject` 与站点公开的 oEmbed 发现信息。
3. 阻止访问 loopback、私网、链路本地、云实例元数据等目标；所有重定向逐次重校验，避免 SSRF。用户明确连接的 Emby 等私有源继续走自己的受控通道。
4. 如果发现可审查的官方 embed URL，只能创建待确认的 Embed 候选；否则降级为 Link 卡片和“打开官方页”。
5. 不从一个页面自动猜测整站搜索 API、登录 Cookie 或播放流地址。

未来可增加“Provider 接入向导”，将站点 URL、一个搜索样例和一个播放样例生成 **禁用状态的适配器草稿**，完成契约与安全测试后才允许启用。该向导不得生成并立即运行任意脚本。

## 10. 扩展包的信任模型

- 简单站点可使用受限声明式适配器：URL 模式、请求模板、JSON 字段映射、分页规则和封面域名，不包含可执行 JavaScript。
- 声明式 Manifest 不得携带 preload、`eval`、动态表达式或任意 CSS；最多提供经验证的播放器根节点选择器，由 Aurora 应用固定裁切和安全样式。
- 需要签名、动态页面或复杂选集的站点需使用代码适配器。正常用户版只加载 Aurora 内置或已签名的适配器。
- 未签名本地适配器只能在显式“开发者模式”中使用，并展示其域名和权限清单。
- 即使是已签名适配器，也不直接获取 Node、文件系统、shell、剪贴板或 Aurora 全量数据；只能通过最小能力 API 工作。
- 适配器更新需声明版本和迁移策略，失效时能独立停用，不影响 Aurora 本地资料库。

## 11. 持久化、缓存和降级

Aurora 可持久化：

- Provider ID/版本、稳定媒体 ID、规范化官方 URL 和公开元数据。
- 受管封面/海报、收藏、标签、备注、项目引用。
- 可选的上次播放单集身份，不保存站点的短期播放 URL。

Aurora 不持久化：

- 密码、Cookie 明文、会员 Token、视频流 URL、DRM 信息。
- 为通用视频页生成的未审查脚本。

降级顺序：

1. 集成播放失败，保留卡片/收藏/项目引用并打开官方页。
2. 一次倒影捕获失败，使用受管封面。
3. 封面缓存失败，使用 Aurora 占位底图。
4. 搜索适配器失效，只标记该来源不可用，不吞掉本地、Emby 或其他来源的结果。

## 12. UI 与交互不变式

- 新 Provider 只向现有九槽卡片和右详情提供标准数据，不创建自己的结果布局。
- 卡片双击和右侧主动作共用同一能力解析。
- 所有在线源的收藏与加入项目由 Aurora 核心操作联动，Provider 不另存一份状态。
- 在线播放继续复用帧环页的顶部导航、播放框、底部收藏/加入项目和倒影语义。
- Provider 品牌名、内容类型和帐号状态来自 Manifest/标准 DTO，不在 `App.tsx` 中继续增加二选一文案分支。

## 13. 新 Provider 验收清单

### 契约和网络

- 合法/非法 URL、主机混淆、凭据 URL、端口、重定向和媒体 ID 测试。
- 搜索文本清洗、真实分页、去重、取消、超时和限量测试。
- 封面 HTTPS 归一化、域名、MIME、字节上限、解码和原子缓存测试。

### 会话和播放

- 独立 partition、登录成功自动关窗、注销不波及其他 Provider 的测试。
- WebView 附加、导航、弹窗、下载、权限、全屏和窗口命中范围测试。
- 公开、需登录、会员、单集、多集、无封面、改版页面的真实样例。
- 退出全屏、页面切换、连续打开两条在线内容、导航可点和倒影回退测试。

### 数据和打包

- 收藏、取消收藏、加入项目、删除引用、统计和跨重启持久化测试。
- 新来源不把搜索结果、Cookie、密钥或个人资料打进安装包。
- macOS arm64/x64 与 Windows 安装版实机验证，不以 5174 开发页替代桌面包验收。

## 14. 当前实现映射

- B 站：`electron/bilibiliSession.cjs`。
- 腾讯视频：`electron/tencentVideoSession.cjs`。
- 新片场：`electron/xinpianchangSession.cjs`（默认关闭的 beta；官方搜索、受管封面与官方 iframe）。
- 优酷：`electron/youkuSession.cjs`（默认关闭的 beta；官方首屏搜索、独立登录与官方页面播放；不伪造翻页）。
- Provider 注册、能力与默认启用状态：`electron/onlineProviderRegistry.cjs`、`src/data/onlineProviderRegistry.ts`。
- WebView 中央分区防火墙：`electron/onlinePlayerWebviewGuard.cjs`；各 Provider guard 只处理自己的分区。
- 主进程注册与 IPC：`electron/main.cjs`、`electron/preload.cjs`。
- 媒体模型与持久化：`src/data/mediaLibraryTypes.ts`、`src/data/libraryPersistence.ts`。
- 在线结果归一化：`src/features/discovery/createOnlineDiscoveryResults.ts`。
- 搜索合并与动作：`src/features/discovery/mergeOnlineDiscoverySearchResults.ts`、`src/features/discovery/discoveryResultActions.ts`。
- 官方播放：`src/features/frame-ring/OnlineEmbeddedPlayer.tsx`、`src/features/frame-ring/onlineOfficialPlayback.ts`。
- 在线账户入口：`src/features/media-sources/OnlineAccountCenter.tsx`。

当前探索页、收藏、项目引用、详情动作、播放页和平台启用状态已走统一 Provider 链路；旧 B站/腾讯 IPC 仅保留迁移兼容。平台搜索与官方页面结构仍可能随网站改版失效，因此新增来源保持默认关闭并独立降级。

## 15. 推荐实施顺序

1. 先建立 Provider Registry、统一 DTO/能力标记和主进程统一 IPC，不改 UI。
2. 将 B 站和腾讯视频改由 Registry 驱动，以现有行为和专项测试作为基线。
3. 增加“粘贴视频链接”，首先支持已知 Provider 的单条解析。
4. 再增加未知站点的公开元数据 Link 模式，默认不承诺 Aurora 内播放。
5. 完成声明式适配器 Schema 和契约测试后，再开放给用户/开发者导入。
6. 最后评估签名代码适配器 SDK，不在普通版先开放任意脚本。

候选平台的时点性研究不属于当前实现权威，见 [`online-video-provider-research-2026-08-05.md`](./online-video-provider-research-2026-08-05.md)。
