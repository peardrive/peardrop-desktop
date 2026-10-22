/**
 * File-type knowledge: extension → category, label and icon colour.
 * The icon shapes themselves live in components/ui/FileTypeIcon.tsx.
 */

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'text'
  | 'archive'
  | 'code'
  | 'web'
  | 'font'
  | 'app'
  | 'design'
  | 'model'
  | 'data'
  | 'ebook'
  | 'file'

const EXT: Record<string, FileCategory> = {}
const add = (cat: FileCategory, exts: string) => exts.split(' ').forEach((e) => (EXT[e] = cat))
add('image', 'jpg jpeg png gif webp svg bmp tif tiff heic heif ico avif raw cr2 nef apng')
add('video', 'mp4 mov avi mkv webm m4v wmv flv mpg mpeg 3gp ts m2ts mts ogv')
add('audio', 'mp3 wav flac aac m4a ogg opus wma aiff alac mid midi')
add('pdf', 'pdf')
add('word', 'doc docx odt rtf pages')
add('excel', 'xls xlsx ods csv numbers tsv')
add('ppt', 'ppt pptx odp key')
add('text', 'txt md log ini cfg conf nfo')
add('archive', 'zip rar 7z tar gz bz2 xz tgz zst iso dmg')
add('code', 'js jsx ts tsx py rb go rs java c cpp h hpp cs swift kt php sh bat ps1 lua dart sql json yaml yml toml xml')
add('web', 'html htm css scss less')
add('font', 'ttf otf woff woff2')
add('app', 'exe msi apk app deb rpm appimage')
add('design', 'psd ai fig sketch xd indd')
add('model', 'obj fbx stl blend gltf glb 3ds')
add('data', 'db sqlite parquet')
add('ebook', 'epub mobi azw3')

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  image: 'Picture',
  video: 'Video',
  audio: 'Music',
  pdf: 'Document',
  word: 'Document',
  excel: 'Spreadsheet',
  ppt: 'Presentation',
  text: 'Text',
  archive: 'Archive',
  code: 'Code',
  web: 'Web',
  font: 'Font',
  app: 'App',
  design: 'Design',
  model: '3D model',
  data: 'Data',
  ebook: 'Book',
  file: 'File'
}

/** Icon tint per category (works on both themes). */
export const CATEGORY_COLOR: Record<FileCategory, string> = {
  image: '#4a9eff',
  video: '#ff5e5e',
  audio: '#c67cff',
  pdf: '#ff5e5e',
  word: '#3b7cd4',
  excel: '#4dc07a',
  ppt: '#e88536',
  text: '#9aa0aa',
  archive: '#d1a05b',
  code: '#e0b52e',
  web: '#ff9f0a',
  font: '#8e8cf0',
  app: '#5ac8fa',
  design: '#ff6ec7',
  model: '#30c48d',
  data: '#7f8cff',
  ebook: '#c49a6c',
  file: '#9aa0aa'
}

export function extensionOf(name: string | null | undefined): string {
  if (!name) return ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function categoryOf(name: string | null | undefined): FileCategory {
  return EXT[extensionOf(name)] ?? 'file'
}

const VIDEO_THUMB_EXTS = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv', 'ogg', 'mkv', 'avi', 'wmv', 'flv', 'ts', '3gp', 'mts', 'm2ts'])

/** Chromium can try to decode a poster frame for these. */
export const isVideoFile = (name: string | null | undefined) => VIDEO_THUMB_EXTS.has(extensionOf(name))
