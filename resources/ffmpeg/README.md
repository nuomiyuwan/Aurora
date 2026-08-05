# FFmpeg binaries bundled with Aurora

Aurora's macOS arm64 package includes the separate `ffmpeg` and `ffprobe`
executables in `Contents/Resources/bin`. They are used for media inspection,
thumbnail and proxy generation, and clip export.

## Source and license

- Upstream: <https://github.com/FFmpeg/FFmpeg>
- Release tag: `n8.1.2`
- Exact source commit: `38b88335f99e76ed89ff3c93f877fdefce736c13`
- Source snapshot: <https://github.com/FFmpeg/FFmpeg/tree/38b88335f99e76ed89ff3c93f877fdefce736c13>
- Binary license reported by both executables: GNU LGPL version 2.1 or later
- Full terms: `COPYING.LGPLv2.1`
- Upstream licensing notes: `UPSTREAM-LICENSE.md`
- Statically linked libvpx release: `v1.16.0`
- Exact libvpx source commit: `1024874c5919305883187e2953de8fcb4c3d7fa6`
- libvpx source snapshot: <https://chromium.googlesource.com/webm/libvpx/+/1024874c5919305883187e2953de8fcb4c3d7fa6>
- libvpx BSD 3-Clause terms: `LIBVPX-LICENSE`

This build does not enable GPL or nonfree components and does not link libx264,
libx265, FDK AAC, OpenSSL, or Homebrew libraries. The BSD-licensed libvpx 1.16.0
is statically linked for Aurora's transparent VP8/VP9 particle media workflow;
it adds no runtime library dependency. H.264 and HEVC encoding use Apple's
VideoToolbox framework. The FFmpeg and libvpx sources were built without local
changes. FFmpeg includes JPEG routines derived from work by the Independent
JPEG Group; credit is due to the Independent JPEG Group as described in the
upstream licensing notes.

## Build configuration

The binaries are native arm64 Mach-O executables with a macOS 12.0 deployment
target. They link only Apple system libraries/frameworks (`libSystem`, zlib,
bzip2, CoreFoundation, CoreMedia, CoreServices, CoreVideo, and VideoToolbox).
Network protocols and input/output devices are disabled because Aurora only
processes local files.

Canonical configure options (the temporary `--prefix` varies per build):

libvpx:

```text
--target=arm64-darwin25-gcc
--disable-examples
--disable-tools
--disable-docs
--disable-unit-tests
--disable-shared
--enable-static
--enable-vp8
--enable-vp9
--enable-vp9-highbitdepth
```

Both `CFLAGS` and `LDFLAGS` set `-mmacosx-version-min=12.0` for libvpx.

FFmpeg:

```text
--arch=arm64
--target-os=darwin
--cc=xcrun clang
--extra-cflags=-mmacosx-version-min=12.0 -I<libvpx-prefix>/include
--extra-ldflags=-mmacosx-version-min=12.0 -L<libvpx-prefix>/lib
--disable-autodetect
--disable-doc
--disable-debug
--disable-ffplay
--disable-programs
--enable-ffmpeg
--enable-ffprobe
--disable-network
--disable-avdevice
--enable-static
--disable-shared
--enable-videotoolbox
--enable-libvpx
--enable-zlib
--enable-bzlib
--disable-iconv
```

Rebuild and replace the checked-in executables on an Apple Silicon Mac with:

```sh
npm run media-tools:mac:arm64
```

The script verifies the exact upstream commit before building and installs the
license files alongside the binaries' packaging resources.

## Distributed artifacts

| File | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `ffmpeg` | 23,988,952 | `4610b1d0c898550beb018f21db88505c6f3fca5a249cfb2e71c5812f5de06629` |
| `ffprobe` | 23,796,344 | `9e9ccd52dfc46fcd261cf1640d801997b6274ce5f447ffa51c129676b2114afd` |

The hashes describe the binaries bundled in this source tree. Rebuilding with
a different Xcode/SDK version can produce different hashes while using the same
FFmpeg source and configuration.
