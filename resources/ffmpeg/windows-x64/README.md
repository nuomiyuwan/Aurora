# FFmpeg binaries for Aurora on Windows x64

Aurora's Windows x64 package includes separate `ffmpeg.exe` and `ffprobe.exe`
executables in `resources/bin`. They are launched as child processes for media
inspection, thumbnails, visual indexes, proxy generation, particle conversion,
and clip export.

## Binary provenance

- Build provider: BtbN FFmpeg Builds
- Upstream source: https://github.com/FFmpeg/FFmpeg
- Build source: https://github.com/BtbN/FFmpeg-Builds
- FFmpeg version reported by the executables: `n8.1.2-34-g9b6c8969e0-20260802`
- Downloaded artifact: `ffmpeg-n8.1-latest-win64-gpl-8.1.zip`
- Artifact URL: https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-8.1.zip
- Artifact SHA-256 at acquisition: `fd2da84bc6a6039cd97c3f98ad24cc246b51368952b96883a9ff73505712046c`
- FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/9b6c8969e0

The corresponding FFmpeg source is available at the exact commit linked
above. The BtbN build definitions and toolchain used by the published build
are available from the build-source repository. Recipients may rebuild and
replace the executables; Aurora does not require modified FFmpeg sources.

The checked-in binaries are retained with Aurora so later packaging does not
depend on the moving `latest` download URL. Their individual hashes are listed
below.

| File | SHA-256 |
| --- | --- |
| `ffmpeg.exe` | `db1b69fbea94a89aa334bbab2d2ccbf2bf6ce277f30c46c494a71a7103586805` |
| `ffprobe.exe` | `b58d07c477fd50054b6cecf448ecf2313c2f76fef89b8aeecbe8020522c07a54` |

## License

This Windows build enables GPL components, including libx264 and libx265, and
reports GNU GPL version 3 or later. The full license text is included beside
this document as `COPYING.GPLv3.txt`. Aurora does not link these executables
into its process; it invokes them as separate command-line programs.
