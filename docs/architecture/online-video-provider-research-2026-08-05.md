# Aurora 候选在线视频平台研究

状态：只读可行性研究，不代表已接入或已获得平台授权
研究日期：2026-08-05
候选平台：优酷、爱奇艺、芒果 TV、新片场

本文记录官网在研究日期的公开行为和 Aurora 的产品判断。页面、内部接口、协议与播放器都可能变化；实施时仍以平台当时的官方文档、授权条件和真实安装包验证为准。

实施注记：2026-08-05 已将新片场与优酷作为**默认关闭的 beta Provider** 接入。新片场使用官方搜索与官方 iframe；优酷只读取官方搜索首屏并使用官方页面播放，不使用需 `client_id` 的视频云 API 伪装全站目录，也不绕过翻页验证码。该试点不改变本文的授权与改版风险判断。

## 1. 结论

推荐接入顺序：

1. **新片场**：最贴合 Aurora 的创作参考场景，作品 ID、封面和官方专用播放器结构清楚。先做 Link + 官方 Embed；站内搜索需取得许可后再正式开放。
2. **芒果 TV**：节目、单集、选集和官方播放页较完整。可先做 Link + 官方页面播放 + 选集；搜索仅作受控实验。
3. **优酷**：首屏公开搜索和节目数据质量较好，但真实翻页会触发风控，软件内播放也需要更多实机与授权验证。先做 Link 解析。
4. **爱奇艺**：技术上能识别公开链接和搜索元数据，但官方反盗链声明明确限制未经许可的嵌套与深度链接。取得书面许可或正式合作方案前，不在 Aurora 内嵌播放。

四个平台都不应通过复制网页私有签名、提取流地址、绕过验证码或 DRM 的方式上线。用户在账号中心主动启用某个平台后，它才参与探索页搜索；启用和登录保持独立。

## 2. 能力矩阵

| 平台 | Link | Search | 官方播放 | Account | Episodes | 建议发布状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 新片场 | 可做 | 技术已验证，正式发布需许可 | 有专用官方 iframe | 首版暂缓 | 不适用 | 默认关闭；Link/Embed 试点 |
| 芒果 TV | 可做 | 内部签名接口，只能实验 | 完整官方页面可试 | 可设计，需实机验收 | 可做 | 默认关闭；Link/播放/选集试点 |
| 优酷 | 可做 | 首屏可读，翻页风控阻断 | 完整官方页面仅实验 | 可设计，需实机验收 | 可解析 | 默认关闭；先做 Link |
| 爱奇艺 | 仅谨慎保存公开元数据 | 技术可行但非公开合同 | 未获许可前禁止内嵌 | 暂缓 | 部分可解析 | 默认关闭；只研究/外部官方页 |

这里的“技术已验证”只表示官网当前能返回相应信息，不等于平台向第三方提供了稳定、可商用的开放 API。

## 3. 新片场

### 已确认

- 官网有公开作品目录、搜索入口、作品时长、作者、分类和封面；[新片场首页](https://www.xinpianchang.com/)也明确展示登录后高清观看等能力。
- 搜索路由为 [`/search?kw=广告`](https://www.xinpianchang.com/search?kw=%E5%B9%BF%E5%91%8A)。官网当前使用的响应包含真实页码、总数和下一页，但它不是公开开发者 API。
- 作品使用稳定数字 article ID，规范页面形如 [`a13772048`](https://www.xinpianchang.com/a13772048)。Aurora 应以 article ID 作为稳定资产身份，不持久化播放器临时 media ID。
- 存在专用官方播放器入口 [`/iframe/a13772048`](https://www.xinpianchang.com/iframe/a13772048)，会进入 `player.xinpianchang.com`；这比裁切完整主站页面更适合 Aurora。
- 内容主体是一作品一视频，不应把创作人其他作品、收藏夹或相关推荐伪装成“选集”。

### 风险与边界

- 主站存在较强反自动化保护，无状态访问可能返回 403/406；不能依赖抓取主站 DOM。
- [新片场用户协议](https://www.xinpianchang.com/aboutus/responsibility)对通过非本站提供界面使用网站有限制。专用官方 iframe 可作为技术试点，但站内搜索和产品发布仍需商务/合规确认。
- 搜索响应可能混入素材商品推荐；Aurora 只能接收作品列表，不能把素材商品混进视频结果。
- 首版不声明 Account 和 Episodes；倒影直接用受管封面，不从在线视频生成帧环或视觉索引。

### 建议身份

```text
asset:online:xinpianchang:video:<articleId>
```

## 4. 芒果 TV

### 已确认

- 官方搜索入口为 [`so.mgtv.com/so?k=你好`](https://so.mgtv.com/so?k=%E4%BD%A0%E5%A5%BD)，页面当前具有真实分页语义，但请求包含时间戳、随机数和动态签名，不能把签名逆向结果当作产品协议。
- 节目/季页面形如 `https://www.mgtv.com/h/<clipId>.html`；单集页面形如 `https://www.mgtv.com/b/<clipId>/<videoId>.html`。系列资产用 `clipId`，当前单集用 `playbackId=videoId`。
- 官方功能说明确认播放页具有选集、收藏和播放记录等能力：[芒果 TV 功能介绍](https://omgotv.mgtv.com/feature)。
- 公开样例 [`h/822501.html`](https://www.mgtv.com/h/822501.html)和 [`b/822501/24531478.html`](https://www.mgtv.com/b/822501/24531478.html)可用于节目、单集和播放器验收；VIP 样例必须继续由官方页面判断权限。
- 官方登录入口是 [`i.mgtv.com/account/login/`](https://i.mgtv.com/account/login/)，未来应使用独立持久 Session。

### 风险与边界

- 未发现面向普通第三方的稳定目录搜索 API；不复制动态签名，也不把内部搜索端点声明为正式能力。
- 官方页面顶层播放当前可行，不代表 VIP、DRM、广告和以后页面结构都兼容 Electron。
- 首版应完整加载官方视频页，只把命中范围限制在 Aurora 播放框；不提取流地址、不隐藏平台版权信息。
- 倒影默认使用受管节目/单集封面。播放器截图最多尝试一次，失败立即回退，禁止循环重载页面。

### 建议身份

```text
asset:online:mango:series:<clipId>
playbackId = <videoId>
```

## 5. 优酷

### 已确认

- 官方搜索页 [`so.youku.com/search/q_甄嬛传`](https://so.youku.com/search/q_%E7%94%84%E5%AC%9B%E4%BC%A0)首屏会输出节目、视频、封面、选集和分页元数据。
- 节目入口形如 [`video?s=cbff984c962411de83b1`](https://v.youku.com/video?s=cbff984c962411de83b1)，单集入口形如 [`v_show/id_XMzcxNDY5ODQ4.html`](https://v.youku.com/v_show/id_XMzcxNDY5ODQ4.html)。节目用 `showId`，单集/独立视频用 `videoId`。
- [优酷视频云单条视频文档](https://cloud.youku.com/docs?id=46)公开了需 `client_id` 的视频元数据接口；这证明优酷有正式开发者体系，但不等于 Aurora 已获整个消费内容目录的搜索与播放授权。

### 风险与边界

- 实测搜索第 2 页会触发 `FAIL_SYS_USER_VALIDATE/RGV587_ERROR` 验证码；不得复制 MTop 私有签名或自动绕过验证。
- 搜索页响应带 `X-Frame-Options: SAMEORIGIN`。完整官方页可作为 Electron 顶层 WebView 实验，但不能用普通 iframe，也不能承诺所有内容可播。
- [优酷视频云开发者协议](https://cloud.youku.com/docs?id=146)要求使用 AppID、接受审核并限制平台数据用途；正式上线前应申请合适的官方能力或书面许可。
- 登录使用独立 `persist:aurora-online-youku-v1`，但首版只把它作为待验收能力；倒影必须以海报兜底。

### 建议身份

```text
asset:online:youku:series:<showId>
asset:online:youku:video:<videoId>
```

## 6. 爱奇艺

### 已确认

- 官方搜索入口为 [爱奇艺搜索](https://so.iqiyi.com/)；官方算法公示说明其搜索覆盖长视频、短视频、爱奇艺号等多种结果：[爱奇艺算法与模型备案](https://www.iqiyi.com/common/modelfiling.html)。
- 当前搜索页面可返回分页、专辑 `qipuId`、单集 `tvId/videoQipuId`、封面和部分选集信息，但这些页面内部接口不是公开开发者合同。
- 专辑样例 [`a_1fkgtbddd2x.html`](https://www.iqiyi.com/a_1fkgtbddd2x.html?jump=0)与单集样例 [`v_xkt6z3z798.html`](https://www.iqiyi.com/v_xkt6z3z798.html)可用于身份和选集研究。
- [爱奇艺实验室](https://www.iqiyi.com/labs/index.html)说明其采用自研 ChinaDRM/DRM SDK；Electron 不应假定具备会员和受保护内容所需的许可链。

### 当前阻断项

- 爱奇艺的[反盗版和反盗链声明](https://www.iqiyi.com/common/announce.html)明确禁止未经许可的嵌套、深度链接和其他直接或间接使用视频内容的方式。
- 因此，在取得爱奇艺书面许可、官方 SDK 或合作方案前，Aurora 不声明 `official-playback` 和 `account`，也不裁切其官方页面做内嵌播放器。
- 若保留研究开关，最多验证公开元数据和搜索契约；正式产品只允许用户打开官方站点，且上线前仍需复核“深度链接”条款。
- 倒影始终使用受管封面，不尝试抓取 DRM 画面。

### 建议身份

```text
asset:online:iqiyi:series:<albumQipuId>
playbackId = <tvIdOrVideoQipuId>
```

## 7. 实施门槛

任何候选平台进入代码前，必须先满足：

1. Provider Registry 和统一 IPC 已落地，B 站/腾讯视频先迁移为基线，不能继续在 `App.tsx` 添加平台分支。
2. 账号中心具备独立的“启用”和“登录”状态；新增平台默认关闭。
3. 每个平台有独立 Session、域名白名单、搜索取消/超时、受管封面和熔断开关。
4. 搜索必须是真分页、稳定 ID 去重和平台间平衡首屏；页面改版时只停用该来源。
5. 官方播放只使用获准的官方页/官方 embed，不提取流、不下载、不绕过广告、会员、地区、验证码或 DRM。
6. 取得与实际发布方式相符的平台许可或完成法务审查；“官网能打开”不等于第三方产品可分发。

## 8. 建议下一步

1. 先完成 Provider Registry 与平台启用开关，不新增平台 UI 分支。
2. 以新片场做第一个受限试点：Link、受管封面、官方 iframe、收藏与项目引用；搜索默认关闭。
3. 再验证芒果 TV 的节目/单集身份、选集和完整官方页播放；搜索保持 beta。
4. 优酷先接链接解析，申请或确认官方开放能力后再决定搜索和播放。
5. 爱奇艺在取得许可前保持禁用，只保留研究记录。
