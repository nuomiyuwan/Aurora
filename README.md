# Aurora

Aurora 是一个面向影像素材与三维资产的桌面视觉资料库。它以具有空间感的卡片、帧环和倒影界面组织本地视频、在线内容与 3D 模型，并提供检索、预览、标注、剪辑和单帧导出能力。

> 当前版本是公开技术预览版。安装包尚未使用 Apple Developer ID 公证或 Windows Authenticode 商业签名，适合体验、测试和共同开发。

## 主要能力

- 项目库：视频项目与三维项目共用同一套项目管理体验。
- 本地影像：读取真实媒体参数，建立视觉索引与帧环，播放、收藏、标签、备注、剪辑及单帧导出。
- 三维资产：导入 GLB/GLTF 等模型，旋转查看、切换视角、调整基础环境并导出当前视图。
- 统一探索：按文件名、标签和备注检索本地视频、帧与模型；可选 AI 画面语义搜索。
- 在线来源：在用户主动开启后，通过隔离的官方网页会话检索和播放 Bilibili、腾讯视频、优酷、新片场等内容；也支持 Emby 媒体库。
- 跨平台：提供 macOS Apple Silicon、macOS Intel 与 Windows x64 构建。

## 下载与安装

安装程序在 [GitHub Releases](https://github.com/nuomiyuwan/Aurora/releases) 中提供。

### macOS

选择与电脑芯片对应的 DMG：

- `arm64`：Apple M 系列芯片。
- `x64`：Intel 芯片。

当前公开预览包使用 ad-hoc 签名且未公证。请先核对 Release 页面公布的 SHA-256；若 Gatekeeper 仍提示“无法验证”或“已损坏”，可将应用拖入“应用程序”后，右键选择“打开”。仅在确认下载来源与校验值无误后，才使用：

```sh
xattr -dr com.apple.quarantine /Applications/Aurora.app
```

### Windows

运行 x64 Setup 安装器。由于当前安装包尚未商业签名，Windows SmartScreen 可能显示未知发布者提示。

## 本地开发

### 环境

- Git 与 [Git LFS](https://git-lfs.com/)
- Node.js 22.12 或更高版本
- npm
- macOS 打包需要 Xcode Command Line Tools

```sh
git clone https://github.com/nuomiyuwan/Aurora.git
cd Aurora
git lfs pull
npm ci
```

启动 Electron 开发版：

```sh
npm run desktop
```

仅启动 `127.0.0.1:5174` 的前端开发页：

```sh
npm run dev
```

检查与构建：

```sh
npm run lint
npm test
npm run build
```

生成安装程序：

```sh
npm run package:mac:arm64:installer
npm run package:mac:x64:installer
npm run package:win:installer
```

FFmpeg/FFprobe 构建依赖位于 `resources/bin`，由 Git LFS 管理。组件来源、精确版本、哈希与许可见 `resources/ffmpeg`。

## 数据与隐私

- Aurora 默认引用用户选择的原始文件，不把个人媒体提交到源码仓库或安装包。
- 项目、索引、封面缓存与设置保存在 Electron 的本机 `userData` 目录；删除应用程序本体不会自动删除这些资料。
- API Key 由 Electron `safeStorage` 在本机加密，渲染层无法读取保存后的明文。
- 在线平台登录分别保存在隔离的 Electron session 中，不写入源码目录。
- AI 画面搜索仅在用户启用并配置服务后运行；发送的是 Aurora 生成的关键帧缩略图与检索文本，不发送原始视频。具体数据处理还取决于用户选择的模型服务商。

## 在线平台说明

Aurora 与 Bilibili、腾讯视频、优酷、新片场及其他内容平台没有隶属、授权或背书关系。在线播放依赖各平台公开网页与用户自己的合法账号；清晰度、会员权限、广告、地区限制和可用性由平台决定。Aurora 不提供下载、破解、去广告或绕过访问控制的能力。平台页面或规则变化可能导致适配暂时失效。

## 开源许可

Aurora 自有源码采用 [MIT License](LICENSE)。第三方库、编解码器、HDR 环境图和解码器仍分别遵循其原始许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

欢迎提交 Issue 和 Pull Request。涉及在线平台的改动请保持“官方页面承载播放、隔离登录态、不绕过平台限制”的边界。
