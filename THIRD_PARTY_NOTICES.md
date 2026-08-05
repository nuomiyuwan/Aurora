# Third-party notices

Aurora 自有源码使用 MIT License。以下第三方组件、二进制文件与素材不因被收录在本仓库中而改变其原始许可。

## Runtime libraries

- Electron — MIT License
- React / React DOM — MIT License
- Three.js — MIT License
- Lucide — ISC License
- jpeg-js — BSD-3-Clause License
- pngjs — MIT License

完整依赖版本记录在 `package-lock.json`，对应许可随各 npm 包分发。

## FFmpeg and libvpx

- macOS `ffmpeg` / `ffprobe`：FFmpeg `n8.1.2`，LGPL-2.1-or-later；静态使用的 libvpx 为 BSD-3-Clause。精确源码提交、构建参数、哈希和许可文本位于 `resources/ffmpeg`。
- Windows x64 `ffmpeg.exe` / `ffprobe.exe`：BtbN FFmpeg Builds 的 GPLv3-or-later 构建。精确 FFmpeg 提交、构建来源、二进制哈希和 GPLv3 文本位于 `resources/ffmpeg/windows-x64`。

Aurora 将这些程序作为独立子进程调用，不把它们链接到 Aurora 进程中。接收 Windows 安装包的用户可从记录的 FFmpeg 精确提交与 BtbN 构建仓库取得对应源码和构建系统。

## Draco decoder

`public/aurora/draco` 中的 Draco WebAssembly/JavaScript 解码器来自 Google Draco 项目，使用 Apache License 2.0。许可全文保存在该目录的 `LICENSE` 文件中。

## HDR environments

`public/aurora/hdr-environments` 中的环境图来自 Poly Haven，使用 CC0。每个文件的来源与哈希见该目录的 `README.md`。

## Aurora visual assets

`public/aurora` 与 `build` 中未另行标注来源的 Aurora 品牌、界面及视觉素材随本项目分发；第三方内容仍以所在目录的许可或来源说明为准。MIT License 不授予对第三方商标、平台名称或平台内容的任何权利。
