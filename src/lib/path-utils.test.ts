import { describe, expect, it } from 'vitest'
import { resolvePathnameWithinRoot, resolveServerBuildFileUrl } from './path-utils.ts'

describe('resolvePathnameWithinRoot', () => {
  it('returns normalized path when within root', () => {
    expect(resolvePathnameWithinRoot('/app/public', 'assets/./logo.svg')).toBe('assets/logo.svg')
  })

  it('sanitizes traversal-like input to stay within root', () => {
    expect(resolvePathnameWithinRoot('/app/public', '../../etc/passwd')).toBe('etc/passwd')
  })

  it('normalizes windows-style separators', () => {
    expect(resolvePathnameWithinRoot('/app/public', 'assets\\icons\\a.svg')).toBe(
      'assets/icons/a.svg',
    )
  })
})

describe('resolveServerBuildFileUrl', () => {
  it('resolves relative paths to file URLs using cwd', () => {
    let url = resolveServerBuildFileUrl('./build/server/index.js')
    expect(url.protocol).toBe('file:')
    expect(url.pathname.endsWith('/build/server/index.js')).toBe(true)
  })

  it('supports absolute file paths', () => {
    let url = resolveServerBuildFileUrl('/tmp/server.mjs')
    expect(url.href).toBe('file:///tmp/server.mjs')
  })

  it('rejects non-file URL protocols', () => {
    expect(() => resolveServerBuildFileUrl('https://example.com/server.mjs')).toThrow(
      'serverBuildFile must use the file: protocol',
    )
  })
})
