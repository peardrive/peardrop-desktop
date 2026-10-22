/**
 * FileTypeIcon — category-tinted glyph for a file name (photo, video,
 * audio, document, archive, code …), used wherever there is no real preview.
 * Folders use `FolderGlyph` instead.
 *
 * @example <FileTypeIcon name="holiday.mp4" className="h-9 w-9" />
 */
import type { ReactNode } from 'react'
import { CATEGORY_COLOR, categoryOf, type FileCategory } from '../../lib/file-types'
import { cn } from '../../lib/cn'

const SHADE = 'rgba(0,0,0,0.38)'
const PAGE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z'
const FOLD = <path d="M14 2v6h6" fill="rgba(0,0,0,0.18)" />
const lines = (d: string, w = 1.3) => <path d={d} stroke={SHADE} strokeWidth={w} strokeLinecap="round" fill="none" />

const SHAPES: Record<FileCategory, ReactNode> = {
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9" r="1.6" fill={SHADE} />
      <path d="M4 18l4.5-5 3 3 3.5-4 5 6z" fill={SHADE} />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10 9l6 3-6 3z" fill="rgba(0,0,0,0.42)" />
    </>
  ),
  audio: <path d="M17 4v10.3a3.5 3.5 0 1 1-2-3.15V7l-6 1.5v9.8a3.5 3.5 0 1 1-2-3.15V5.6z" />,
  pdf: (
    <>
      <path d={PAGE} />
      {FOLD}
      {lines('M7 14h10M7 17h7', 1.4)}
    </>
  ),
  word: (
    <>
      <path d={PAGE} />
      {FOLD}
      {lines('M7 13h10M7 16h10M7 19h6', 1.2)}
    </>
  ),
  excel: (
    <>
      <path d={PAGE} />
      {FOLD}
      {lines('M6 13h12M6 16h12M6 19h12M10 12v9M14 12v9', 0.9)}
    </>
  ),
  ppt: (
    <>
      <path d={PAGE} />
      {FOLD}
      <rect x="7" y="15" width="2" height="4" fill={SHADE} />
      <rect x="11" y="12" width="2" height="7" fill={SHADE} />
      <rect x="15" y="14" width="2" height="5" fill={SHADE} />
    </>
  ),
  text: (
    <>
      <path d={PAGE} />
      {FOLD}
      {lines('M7 12h10M7 15h10M7 18h7', 1.2)}
    </>
  ),
  archive: (
    <>
      <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3z" />
      <path d="M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <rect x="10.5" y="12" width="3" height="5" rx="0.6" fill={SHADE} />
    </>
  ),
  code: (
    <>
      <path d={PAGE} />
      {FOLD}
      <path d="M10.5 12L7 15l3.5 3M13.5 12L17 15l-3.5 3" stroke="rgba(0,0,0,0.45)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      {lines('M3 12h18M12 3a12 12 0 0 1 0 18M12 3a12 12 0 0 0 0 18', 1.2)}
    </>
  ),
  font: (
    <>
      <path d={PAGE} />
      {FOLD}
      <path d="M8 19l4-9 4 9M9.6 16h4.8" stroke={SHADE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  app: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M8 12h8M12 8v8" stroke={SHADE} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  design: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.9 1.7-1.8 0-.5-.3-.9-.3-1.4 0-.6.5-1 1-1h1.6a4 4 0 0 0 4-4C20 7.3 16.4 3 12 3z" />
      <circle cx="7.5" cy="11" r="1.2" fill={SHADE} />
      <circle cx="10" cy="7" r="1.2" fill={SHADE} />
      <circle cx="14" cy="7" r="1.2" fill={SHADE} />
      <circle cx="17" cy="10.5" r="1.2" fill={SHADE} />
    </>
  ),
  model: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      {lines('M3 7l9 5 9-5M12 12v10', 1.2)}
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="2.8" />
      <path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6" />
      <path d="M4 12v6.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V12" />
      {lines('M4 11.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8', 1)}
    </>
  ),
  ebook: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
      <path d="M13 3h5.5A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5H13z" />
    </>
  ),
  file: (
    <>
      <path d={PAGE} />
      {FOLD}
    </>
  )
}

export interface FileTypeIconProps {
  /** File name used to pick the category. */
  name: string | null | undefined
  className?: string
}

export function FileTypeIcon({ name, className }: FileTypeIconProps) {
  const cat = categoryOf(name)
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('h-8 w-8', className)} style={{ color: CATEGORY_COLOR[cat] }}>
      {SHAPES[cat]}
    </svg>
  )
}

/**
 * FolderGlyph — the teal iOS-Files-style folder used for multi-file shares.
 *
 * @example <FolderGlyph className="h-10 w-10" />
 */
export function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('h-8 w-8 text-folder', className)}>
      <path d="M3.4 4h4.2a1.6 1.6 0 0 1 1.13.47L10 5.5H3v.1A1.6 1.6 0 0 1 3.4 4z" />
      <path d="M2 8.4a1.6 1.6 0 0 1 1.6-1.6h16.8A1.6 1.6 0 0 1 22 8.4v10.2a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 18.6z" />
    </svg>
  )
}
