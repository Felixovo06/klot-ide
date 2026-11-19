import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let inputArg = '';
  let cropPx = 0;
  let previewOut = '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--crop' && i + 1 < argv.length) {
      cropPx = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--crop=')) {
      cropPx = Number(arg.slice('--crop='.length));
    } else if (arg === '--preview-out' && i + 1 < argv.length) {
      previewOut = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--preview-out=')) {
      previewOut = arg.slice('--preview-out='.length);
    } else if (!arg.startsWith('-') && !inputArg) {
      inputArg = arg;
    }
  }

  return {
    inputArg,
    cropPx: Number.isFinite(cropPx) && cropPx >= 0 ? cropPx : 0,
    previewOut,
  };
}

const { inputArg, cropPx, previewOut } = parseArgs(process.argv.slice(2));
if (!inputArg) {
  console.error('用法: node scripts/apply-icon.mjs <inputImagePath> [--crop <px>] [--preview-out <path>]');
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), inputArg);
if (!fs.existsSync(inputPath)) {
  console.error(`输入图标文件不存在: ${inputPath}`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ke-icon-'));
const trimmedPng = path.join(tmpDir, 'icon-1024-squircle.png');

const swiftSource = `
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else {
    fputs("missing arguments\\n", stderr)
    exit(1)
}
let inputPath = args[1]
let outputPath = args[2]
let cropPx = max(0.0, Double(args[3]) ?? 0.0)

guard let srcImage = NSImage(contentsOfFile: inputPath) else {
    fputs("failed to load input image\\n", stderr)
    exit(1)
}

var pixelW = srcImage.size.width
var pixelH = srcImage.size.height
if let bestRep = srcImage.representations.first {
    if bestRep.pixelsWide > 0 && bestRep.pixelsHigh > 0 {
        pixelW = CGFloat(bestRep.pixelsWide)
        pixelH = CGFloat(bestRep.pixelsHigh)
    }
}
srcImage.size = NSSize(width: pixelW, height: pixelH)

let size = 1024
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bitmapFormat: [],
    bytesPerRow: size * 4,
    bitsPerPixel: 32
) else {
    fputs("failed to allocate bitmap\\n", stderr)
    exit(1)
}

guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else {
    fputs("failed to create graphics context\\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx
ctx.imageInterpolation = .high

NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

let iconRect = NSRect(x: 100, y: 100, width: 824, height: 824)
let clipPath = NSBezierPath(roundedRect: iconRect, xRadius: 185, yRadius: 185)
ctx.saveGraphicsState()
clipPath.addClip()

let safeCropX = min(CGFloat(cropPx), (pixelW - 16.0) / 2.0)
let safeCropY = min(CGFloat(cropPx), (pixelH - 16.0) / 2.0)
let fromRect = NSRect(
    x: safeCropX,
    y: safeCropY,
    width: max(1.0, pixelW - safeCropX * 2.0),
    height: max(1.0, pixelH - safeCropY * 2.0)
)
srcImage.draw(
    in: iconRect,
    from: fromRect,
    operation: .sourceOver,
    fraction: 1.0
)
ctx.restoreGraphicsState()

let borderRect = NSRect(x: 100.5, y: 100.5, width: 823, height: 823)
let borderPath = NSBezierPath(roundedRect: borderRect, xRadius: 184.5, yRadius: 184.5)
borderPath.lineWidth = 1.0
NSColor(calibratedWhite: 1.0, alpha: 0.28).setStroke()
borderPath.stroke()

ctx.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let pngData = rep.representation(using: .png, properties: [:]) else {
    fputs("failed to encode png\\n", stderr)
    exit(1)
}

do {
    try pngData.write(to: URL(fileURLWithPath: outputPath))
} catch {
    fputs("failed to write png: \\(error)\\n", stderr)
    exit(1)
}
`;

try {
  execFileSync('/usr/bin/swift', ['-', inputPath, trimmedPng, String(cropPx)], {
    input: swiftSource,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (previewOut) {
    const absPreview = path.resolve(process.cwd(), previewOut);
    fs.mkdirSync(path.dirname(absPreview), { recursive: true });
    fs.copyFileSync(trimmedPng, absPreview);
    console.log('已输出预览图标:', absPreview);
  }

  const iconsDir = path.join(REPO_ROOT, 'src-tauri', 'icons');
  execFileSync('npx', ['tauri', 'icon', trimmedPng, '-o', iconsDir], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  // 清理非桌面平台图标文件，保持 src-tauri/icons 整洁
  for (const name of fs.readdirSync(iconsDir)) {
    if (
      name === 'android' ||
      name === 'ios' ||
      name.startsWith('Square') ||
      name === 'StoreLogo.png'
    ) {
      fs.rmSync(path.join(iconsDir, name), { recursive: true, force: true });
    }
  }

  console.log('已生成圆角 macOS 图标集到:', path.relative(REPO_ROOT, iconsDir));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
