const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const defaultSource = path.join(
  projectRoot,
  "android",
  "ffmpeg-kit-local",
  "com",
  "arthenica",
  "ffmpeg-kit-full-gpl",
  "6.0-2.LTS",
  "ffmpeg-kit-full-gpl-6.0-2.LTS.aar"
);

const source = process.env.FFMPEG_KIT_AAR
  ? path.resolve(process.env.FFMPEG_KIT_AAR)
  : defaultSource;

const destDir = path.join(
  projectRoot,
  "node_modules",
  "ffmpeg-kit-react-native",
  "android",
  "libs"
);
const dest = path.join(destDir, "ffmpeg-kit-release.aar");

if (!fs.existsSync(source)) {
  console.warn(
    "[ffmpeg-kit] Local AAR not found. Expected at:",
    source
  );
  console.warn(
    "[ffmpeg-kit] Set FFMPEG_KIT_AAR to override the source path."
  );
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
console.log("[ffmpeg-kit] Copied local AAR to:", dest);
