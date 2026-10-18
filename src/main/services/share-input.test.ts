import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildShareInput, EmptyShareError, flattenShareSources } from './share-input'

const abs = (p: string) => path.resolve('/tmp', p)

describe('flattenShareSources', () => {
  it('expands folders flat and de-duplicates names case-insensitively', () => {
    const files = flattenShareSources([
      { name: 'a.txt', path: abs('a.txt'), size: 1, type: 'file' },
      {
        name: 'dir',
        path: abs('dir'),
        size: 3,
        type: 'folder',
        fileCount: 2,
        contents: [
          { name: 'A.TXT', path: abs('dir/A.TXT'), size: 1, relativePath: 'A.TXT' },
          { name: 'b.txt', path: abs('dir/sub/b.txt'), size: 2, relativePath: 'sub/b.txt' }
        ]
      }
    ])
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'A (2).TXT', 'b.txt'])
    expect(files.every((f) => f.relativePath === f.name)).toBe(true)
  })

  it('names a single folder after itself and several items "Folder"', () => {
    const one = buildShareInput([{ name: 'pics', path: abs('pics'), size: 1, type: 'folder', contents: [{ name: 'x.png', path: abs('pics/x.png'), size: 1, relativePath: 'x.png' }] }], {})
    expect(one.name).toBe('pics')
    expect(one.localPath).toBe(abs('pics'))
    const many = buildShareInput(
      [
        { name: 'a', path: abs('a'), size: 1, type: 'file' },
        { name: 'b', path: abs('b'), size: 2, type: 'file' }
      ],
      { clientJobId: 'job1' }
    )
    expect(many).toMatchObject({ name: 'Folder', totalBytes: 3, clientJobId: 'job1' })
  })

  it('refuses an empty folder', () => {
    expect(() => buildShareInput([{ name: 'e', path: abs('e'), size: 0, type: 'folder', contents: [] }], {})).toThrow(EmptyShareError)
  })
})
