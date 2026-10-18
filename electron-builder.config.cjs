/**
 * electron-builder configuration.
 *
 * Identity (name, id, icon, copyright) comes from app.config.json so the
 * installer, the OS app name and the in-app About page can never disagree.
 *
 *   npm run build:win    → NSIS installer + portable  (dist/)
 *   npm run build:mac    → dmg + zip (x64 + arm64)
 *   npm run build:linux  → AppImage + deb
 *   npm run build:dir    → unpacked app, fastest smoke test
 *
 * Cross-building: Windows targets build on any OS (Wine needed for NSIS on
 * Linux/macOS); mac targets need macOS; Linux targets build on Linux/macOS.
 */
const identity = require('./app.config.json')

module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  copyright: identity.copyright,
  directories: {
    output: 'dist',
    buildResources: 'assets'
  },
  files: [
    'out/**/*',
    'src/engine/**/*.js',
    'app.config.json',
    'assets/icons/**/*',
    'package.json',
    '!**/*.map'
  ],
  // Hyperswarm/corestore pull in sodium-native, udx-native, rocksdb-native …
  // which load prebuilt .node binaries at runtime. Those cannot be read from
  // inside an asar archive.
  asarUnpack: ['**/node_modules/**/*.node', '**/node_modules/**/prebuilds/**'],
  icon: identity.icon,
  protocols: [{ name: `${identity.productName} link`, schemes: [identity.linkScheme] }],
  extraMetadata: {
    main: 'out/main/index.js'
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    icon: identity.icon,
    artifactName: '${productName}-${version}-win-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: identity.productName
  },
  portable: {
    artifactName: '${productName}-${version}-portable.${ext}'
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    category: 'public.app-category.productivity',
    icon: identity.icon,
    artifactName: '${productName}-${version}-mac-${arch}.${ext}'
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Network',
    icon: identity.icon,
    maintainer: identity.author,
    synopsis: identity.description,
    artifactName: '${productName}-${version}-linux-${arch}.${ext}'
  }
}
