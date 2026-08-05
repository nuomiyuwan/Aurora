#!/usr/bin/env bash

set -euo pipefail

ffmpeg_tag='n8.1.2'
ffmpeg_commit='38b88335f99e76ed89ff3c93f877fdefce736c13'
libvpx_tag='v1.16.0'
libvpx_commit='1024874c5919305883187e2953de8fcb4c3d7fa6'
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd "$script_directory/.." && pwd)
build_directory=$(mktemp -d "${TMPDIR:-/tmp}/aurora-ffmpeg-x64-build.XXXXXX")
ffmpeg_source_directory="$build_directory/FFmpeg"
ffmpeg_install_directory="$build_directory/ffmpeg-install"
libvpx_source_directory="$build_directory/libvpx"
libvpx_build_directory="$build_directory/libvpx-build"
libvpx_install_directory="$build_directory/libvpx-install"

cleanup() {
  rm -rf "$build_directory"
}
trap cleanup EXIT

if [[ $(uname -m) != 'x86_64' ]]; then
  echo 'This script must run under Rosetta with: arch -x86_64 bash scripts/build-ffmpeg-macos-x64.sh' >&2
  exit 1
fi

for command_name in git make xcrun; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required build command: $command_name" >&2
    exit 1
  fi
done

git clone --quiet --depth 1 --branch "$ffmpeg_tag" \
  https://github.com/FFmpeg/FFmpeg.git "$ffmpeg_source_directory"
git clone --quiet --depth 1 --branch "$libvpx_tag" \
  https://chromium.googlesource.com/webm/libvpx "$libvpx_source_directory"

resolved_ffmpeg_commit=$(git -C "$ffmpeg_source_directory" rev-parse HEAD)
if [[ $resolved_ffmpeg_commit != "$ffmpeg_commit" ]]; then
  echo "Unexpected FFmpeg commit: $resolved_ffmpeg_commit" >&2
  exit 1
fi

resolved_libvpx_commit=$(git -C "$libvpx_source_directory" rev-parse HEAD)
if [[ $resolved_libvpx_commit != "$libvpx_commit" ]]; then
  echo "Unexpected libvpx commit: $resolved_libvpx_commit" >&2
  exit 1
fi

parallel_jobs=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)

mkdir -p "$libvpx_build_directory"
(
  cd "$libvpx_build_directory"
  CFLAGS='-arch x86_64 -mmacosx-version-min=12.0' \
    LDFLAGS='-arch x86_64 -mmacosx-version-min=12.0' \
    "$libvpx_source_directory/configure" \
      --prefix="$libvpx_install_directory" \
      --target=x86_64-darwin25-gcc \
      --disable-examples \
      --disable-tools \
      --disable-docs \
      --disable-unit-tests \
      --disable-shared \
      --enable-static \
      --enable-vp8 \
      --enable-vp9 \
      --enable-vp9-highbitdepth
  make -j "$parallel_jobs"
  make install
)

(
  cd "$ffmpeg_source_directory"
  ./configure \
    --prefix="$ffmpeg_install_directory" \
    --arch=x86_64 \
    --target-os=darwin \
    --cc='xcrun clang -arch x86_64' \
    --extra-cflags="-arch x86_64 -mmacosx-version-min=12.0 -I$libvpx_install_directory/include" \
    --extra-ldflags="-arch x86_64 -mmacosx-version-min=12.0 -L$libvpx_install_directory/lib" \
    --disable-autodetect \
    --disable-doc \
    --disable-debug \
    --disable-ffplay \
    --disable-programs \
    --enable-ffmpeg \
    --enable-ffprobe \
    --disable-network \
    --disable-avdevice \
    --enable-static \
    --disable-shared \
    --enable-videotoolbox \
    --enable-libvpx \
    --enable-zlib \
    --enable-bzlib \
    --disable-iconv
  make -j "$parallel_jobs"
  make install
)

macos_binary_directory="$project_directory/resources/bin/mac-x64"
mkdir -p "$macos_binary_directory" "$project_directory/resources/ffmpeg"
install -m 0755 "$ffmpeg_install_directory/bin/ffmpeg" \
  "$macos_binary_directory/ffmpeg"
install -m 0755 "$ffmpeg_install_directory/bin/ffprobe" \
  "$macos_binary_directory/ffprobe"
install -m 0644 "$ffmpeg_source_directory/COPYING.LGPLv2.1" \
  "$project_directory/resources/ffmpeg/COPYING.LGPLv2.1"
install -m 0644 "$ffmpeg_source_directory/LICENSE.md" \
  "$project_directory/resources/ffmpeg/UPSTREAM-LICENSE.md"
install -m 0644 "$libvpx_source_directory/LICENSE" \
  "$project_directory/resources/ffmpeg/LIBVPX-LICENSE"

echo "Installed FFmpeg $ffmpeg_tag with libvpx $libvpx_tag for macOS x64."
shasum -a 256 \
  "$macos_binary_directory/ffmpeg" \
  "$macos_binary_directory/ffprobe"
