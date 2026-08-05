[CmdletBinding()]
param(
  [string]$SourcePath = 'docs/visual-sources/reflection-ice-height-source-generated.png',
  [string]$SurfaceOutputPath = 'public/aurora/reflection-ice-surface-generated-2048.png',
  [int]$Width = 2048,
  [int]$Height = 1152,
  [double]$SourceCropTop = 0.59,
  [double]$TargetHeightStandardDeviation = 0.09,
  [double]$TargetNormalSlope95 = 0.38
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

if (-not ('AuroraReflectionMapProcessor' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class AuroraReflectionMapProcessor
{
    private const float HeightMinimum = 0.22f;
    private const float HeightMaximum = 0.78f;

    public static string Generate(
        Bitmap source,
        string surfaceOutputPath,
        float targetHeightStandardDeviation,
        float targetNormalSlope95)
    {
        int width = source.Width;
        int height = source.Height;
        int count = checked(width * height);
        byte[] sourcePixels = ReadPixels(source);
        int sourceStride = GetStride(source);
        float[] luminance = new float[count];
        double[] rowMeans = new double[height];

        for (int y = 0; y < height; y++)
        {
            double rowTotal = 0.0;
            int rowOffset = y * sourceStride;
            int valueOffset = y * width;
            for (int x = 0; x < width; x++)
            {
                int pixelOffset = rowOffset + x * 3;
                float blue = sourcePixels[pixelOffset];
                float green = sourcePixels[pixelOffset + 1];
                float red = sourcePixels[pixelOffset + 2];
                float value = (red * 0.2126f + green * 0.7152f + blue * 0.0722f) / 255.0f;
                luminance[valueOffset + x] = value;
                rowTotal += value;
            }
            rowMeans[y] = rowTotal / width;
        }

        double detailSquaredTotal = 0.0;
        for (int y = 0; y < height; y++)
        {
            int rowOffset = y * width;
            double rowMean = rowMeans[y];
            for (int x = 0; x < width; x++)
            {
                double detail = luminance[rowOffset + x] - rowMean;
                detailSquaredTotal += detail * detail;
            }
        }

        float detailStandardDeviation = (float)Math.Sqrt(detailSquaredTotal / count);
        float heightGain = targetHeightStandardDeviation / Math.Max(detailStandardDeviation, 0.000001f);
        float[] heightField = new float[count];
        double heightTotal = 0.0;

        for (int y = 0; y < height; y++)
        {
            int rowOffset = y * width;
            float rowMean = (float)rowMeans[y];
            for (int x = 0; x < width; x++)
            {
                float value = 0.5f + (luminance[rowOffset + x] - rowMean) * heightGain;
                value = Clamp(value, HeightMinimum, HeightMaximum);
                heightField[rowOffset + x] = value;
                heightTotal += value;
            }
        }

        float heightCenterCorrection = (float)(heightTotal / count) - 0.5f;
        double centeredTotal = 0.0;
        double centeredSquaredTotal = 0.0;
        for (int index = 0; index < count; index++)
        {
            float value = Clamp(
                heightField[index] - heightCenterCorrection,
                HeightMinimum,
                HeightMaximum);
            heightField[index] = value;
            centeredTotal += value;
            double deviation = value - 0.5;
            centeredSquaredTotal += deviation * deviation;
        }

        float[] smoothedHeight = SmoothHeight(heightField, width, height);
        float[] gradientX = new float[count];
        float[] gradientY = new float[count];
        float maximumGradient = 0.0f;

        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int index = y * width + x;
                float nearX = (
                    Sample(smoothedHeight, width, height, x + 1, y)
                    - Sample(smoothedHeight, width, height, x - 1, y)) * 0.5f;
                float nearY = (
                    Sample(smoothedHeight, width, height, x, y + 1)
                    - Sample(smoothedHeight, width, height, x, y - 1)) * 0.5f;
                float broadX = (
                    Sample(smoothedHeight, width, height, x + 4, y)
                    - Sample(smoothedHeight, width, height, x - 4, y)) / 8.0f;
                float broadY = (
                    Sample(smoothedHeight, width, height, x, y + 4)
                    - Sample(smoothedHeight, width, height, x, y - 4)) / 8.0f;
                float dx = nearX * 0.68f + broadX * 0.32f;
                float dy = nearY * 0.68f + broadY * 0.32f;
                gradientX[index] = dx;
                gradientY[index] = dy;
                maximumGradient = Math.Max(maximumGradient, (float)Math.Sqrt(dx * dx + dy * dy));
            }
        }

        float gradient95 = PercentileMagnitude(
            gradientX,
            gradientY,
            maximumGradient,
            0.95f);
        float targetSlope = Clamp(targetNormalSlope95, 0.05f, 0.85f);
        float targetTangent = targetSlope / (float)Math.Sqrt(1.0f - targetSlope * targetSlope);
        float slopeStrength = targetTangent / Math.Max(gradient95, 0.000001f);

        byte[] surfacePixels = new byte[count * 3];
        double normalRedTotal = 0.0;
        double normalGreenTotal = 0.0;

        for (int index = 0; index < count; index++)
        {
            byte heightByte = ToByte(heightField[index]);
            int pixelOffset = index * 3;

            // Image Y grows downward. TextureLoader flips the bitmap on upload, so
            // tangent-space +Y uses the image-space downward height derivative.
            float slopeX = -gradientX[index] * slopeStrength;
            float slopeY = gradientY[index] * slopeStrength;
            float inverseLength = 1.0f / (float)Math.Sqrt(
                slopeX * slopeX + slopeY * slopeY + 1.0f);
            float normalX = slopeX * inverseLength;
            float normalY = slopeY * inverseLength;
            byte red = ToByte(normalX * 0.5f + 0.5f);
            byte green = ToByte(normalY * 0.5f + 0.5f);
            // Packed runtime layout: R=height, G=normal X, B=normal Y.
            surfacePixels[pixelOffset] = green;
            surfacePixels[pixelOffset + 1] = red;
            surfacePixels[pixelOffset + 2] = heightByte;
            normalRedTotal += red / 255.0;
            normalGreenTotal += green / 255.0;
        }

        WritePixels(surfacePixels, width, height, surfaceOutputPath);

        double finalHeightMean = centeredTotal / count;
        double finalHeightStd = Math.Sqrt(centeredSquaredTotal / count);
        return String.Format(
            System.Globalization.CultureInfo.InvariantCulture,
            "height mean={0:F4}, std={1:F4}; normal mean RG=({2:F4}, {3:F4}); gradient p95={4:F6}; slope strength={5:F2}",
            finalHeightMean,
            finalHeightStd,
            normalRedTotal / count,
            normalGreenTotal / count,
            gradient95,
            slopeStrength);
    }

    private static float[] SmoothHeight(float[] source, int width, int height)
    {
        float[] result = new float[source.Length];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                float center = Sample(source, width, height, x, y) * 4.0f;
                float cardinal =
                    Sample(source, width, height, x - 1, y)
                    + Sample(source, width, height, x + 1, y)
                    + Sample(source, width, height, x, y - 1)
                    + Sample(source, width, height, x, y + 1);
                result[y * width + x] = (center + cardinal) / 8.0f;
            }
        }
        return result;
    }

    private static float PercentileMagnitude(
        float[] gradientX,
        float[] gradientY,
        float maximum,
        float percentile)
    {
        const int bucketCount = 4096;
        if (maximum <= 0.0f) return 0.0f;
        int[] histogram = new int[bucketCount];
        for (int index = 0; index < gradientX.Length; index++)
        {
            float magnitude = (float)Math.Sqrt(
                gradientX[index] * gradientX[index]
                + gradientY[index] * gradientY[index]);
            int bucket = Math.Min(
                bucketCount - 1,
                (int)(magnitude / maximum * (bucketCount - 1)));
            histogram[bucket]++;
        }

        int target = (int)Math.Ceiling(gradientX.Length * percentile);
        int accumulated = 0;
        for (int bucket = 0; bucket < bucketCount; bucket++)
        {
            accumulated += histogram[bucket];
            if (accumulated >= target)
            {
                return maximum * bucket / (bucketCount - 1);
            }
        }
        return maximum;
    }

    private static float Sample(float[] values, int width, int height, int x, int y)
    {
        int safeX = Math.Max(0, Math.Min(width - 1, x));
        int safeY = Math.Max(0, Math.Min(height - 1, y));
        return values[safeY * width + safeX];
    }

    private static byte[] ReadPixels(Bitmap bitmap)
    {
        Rectangle rectangle = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(
            rectangle,
            ImageLockMode.ReadOnly,
            PixelFormat.Format24bppRgb);
        try
        {
            byte[] pixels = new byte[Math.Abs(data.Stride) * bitmap.Height];
            Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
            return pixels;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static int GetStride(Bitmap bitmap)
    {
        Rectangle rectangle = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(
            rectangle,
            ImageLockMode.ReadOnly,
            PixelFormat.Format24bppRgb);
        try
        {
            return Math.Abs(data.Stride);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static void WritePixels(byte[] compactPixels, int width, int height, string path)
    {
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
        {
            Rectangle rectangle = new Rectangle(0, 0, width, height);
            BitmapData data = bitmap.LockBits(
                rectangle,
                ImageLockMode.WriteOnly,
                PixelFormat.Format24bppRgb);
            try
            {
                int stride = Math.Abs(data.Stride);
                byte[] paddedPixels = new byte[stride * height];
                for (int y = 0; y < height; y++)
                {
                    Buffer.BlockCopy(compactPixels, y * width * 3, paddedPixels, y * stride, width * 3);
                }
                Marshal.Copy(paddedPixels, 0, data.Scan0, paddedPixels.Length);
            }
            finally
            {
                bitmap.UnlockBits(data);
            }
            bitmap.Save(path, ImageFormat.Png);
        }
    }

    private static float Clamp(float value, float minimum, float maximum)
    {
        return Math.Max(minimum, Math.Min(maximum, value));
    }

    private static byte ToByte(float value)
    {
        return (byte)Math.Round(Clamp(value, 0.0f, 1.0f) * 255.0f);
    }
}
'@
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Resolve-ProjectPath([string]$Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

$resolvedSourcePath = Resolve-ProjectPath $SourcePath
$resolvedSurfaceOutputPath = Resolve-ProjectPath $SurfaceOutputPath

if (-not (Test-Path -LiteralPath $resolvedSourcePath)) {
  throw "Reflection height source not found: $resolvedSourcePath"
}

foreach ($outputPath in @($resolvedSurfaceOutputPath)) {
  $outputDirectory = Split-Path -Parent $outputPath
  if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  }
}

$source = [System.Drawing.Bitmap]::FromFile($resolvedSourcePath)
try {
  $scaled = New-Object System.Drawing.Bitmap(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($scaled)
    try {
      $graphics.Clear([System.Drawing.Color]::FromArgb(128, 128, 128))
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

      $safeCropTop = [Math]::Min(0.9, [Math]::Max(0.0, $SourceCropTop))
      $sourceRectangle = New-Object System.Drawing.RectangleF(
        0,
        [single]($source.Height * $safeCropTop),
        [single]$source.Width,
        [single]($source.Height * (1.0 - $safeCropTop))
      )
      $destinationRectangle = New-Object System.Drawing.RectangleF(
        0,
        0,
        [single]$Width,
        [single]$Height
      )
      $graphics.DrawImage(
        $source,
        $destinationRectangle,
        $sourceRectangle,
        [System.Drawing.GraphicsUnit]::Pixel
      )
    }
    finally {
      $graphics.Dispose()
    }

    $metrics = [AuroraReflectionMapProcessor]::Generate(
      $scaled,
      $resolvedSurfaceOutputPath,
      [single]$TargetHeightStandardDeviation,
      [single]$TargetNormalSlope95
    )
    Write-Output $metrics
    Write-Output "surface (R=height, G=normal X, B=normal Y): $resolvedSurfaceOutputPath"
  }
  finally {
    $scaled.Dispose()
  }
}
finally {
  $source.Dispose()
}
