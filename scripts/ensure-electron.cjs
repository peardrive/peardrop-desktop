#!/usr/bin/env node
/**
 * postinstall guard for the Electron binary.
 *
 * electron-vite finds Electron through node_modules/electron/path.txt, which
 * only electron's own install script writes. Newer npm versions can skip
 * dependency install scripts (the "install-scripts / allowScripts" gate),
 * and an interrupted download leaves dist/ half-extracted — either way
 * `npm run app` then fails with "Electron uninstall".
 *
 * This runs as the PROJECT's postinstall (never gated) and:
 *   1. does nothing when Electron is fully installed,
 *   2. writes path.txt when the binary is present but the pointer is missing,
 *   3. otherwise runs electron's installer (download + unzip) itself.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const BINARY = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron' }

let electronDir
try {
  electronDir = path.dirname(require.resolve('electron/package.json'))
} catch {
  process.exit(0) // electron not installed (production install) — nothing to do
}
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0)

const platform = process.env.npm_config_platform || process.platform
const rel = BINARY[platform] || 'electron'
const { version } = require(path.join(electronDir, 'package.json'))
const pathFile = path.join(electronDir, 'path.txt')
const binary = path.join(electronDir, 'dist', rel)
const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').trim()
  } catch {
    return null
  }
}
const binaryOk = () => fs.existsSync(binary) && (read(path.join(electronDir, 'dist', 'version')) || '').replace(/^v/, '') === version

if (binaryOk() && read(pathFile) === rel) process.exit(0)

if (binaryOk()) {
  fs.writeFileSync(pathFile, rel)
  console.log(`[ensure-electron] restored ${path.relative(process.cwd(), pathFile)} → ${rel}`)
  process.exit(0)
}

console.log(`[ensure-electron] Electron ${version} binary missing or incomplete — running its installer…`)
fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true })
const res = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit', env: process.env })
if (res.status !== 0 || !binaryOk()) {
  console.error(
    '[ensure-electron] Could not install the Electron binary.\n' +
      '  Retry with a mirror:  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ and run `npm run setup:electron`\n' +
      '  Or check antivirus / Controlled Folder Access isn\'t blocking node from writing electron.exe.'
  )
  process.exit(0) // never fail the whole npm install over this
}
if (read(pathFile) !== rel) fs.writeFileSync(pathFile, rel)
console.log('[ensure-electron] Electron installed')
