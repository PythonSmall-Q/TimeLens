/**
 * build-chrome.js
 * Packages the extension as a Chrome Web Store compatible ZIP.
 * Run: node scripts/build-chrome.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const IGNORE = new Set([
  "dist", "package.json", "package-lock.json",
  ".web-ext-config.json", "scripts", "node_modules", ".git",
]);

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const outFile = path.join(DIST, `timelens-${version}-chrome.zip`);

// Build file list
const files = fs.readdirSync(ROOT).filter((f) => !IGNORE.has(f));

// Use PowerShell Compress-Archive or zip
try {
  const fileList = files.map((f) => `"${path.join(ROOT, f)}"`).join(",");
  execSync(
    `powershell -Command "Compress-Archive -Path ${fileList} -DestinationPath '${outFile}' -Force"`,
    { stdio: "inherit" }
  );
  console.log(`Built: ${outFile}`);
} catch {
  console.error("Compression failed. Ensure PowerShell is available or install a zip utility.");
  process.exit(1);
}
