import { pathToFileURL } from 'node:url'
import path from 'node:path'

export function resolvePathnameWithinRoot(root: string, pathname: string): string | null {
  let sanitizedPathname = pathname.replace(/\\/g, '/')
  let normalizedPathname = path.posix.normalize(`/${sanitizedPathname}`).replace(/^\/+/, '')
  let resolvedPath = path.resolve(root, normalizedPathname)
  let relativeToRoot = path.relative(root, resolvedPath)

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null
  }

  return normalizedPathname
}

export function resolveServerBuildFileUrl(input: string | URL): URL {
  let url: URL
  if (input instanceof URL) {
    url = input
  } else if (input.startsWith('file:')) {
    url = new URL(input)
  } else if (input.startsWith('/')) {
    url = pathToFileURL(input)
  } else {
    url = new URL(input, pathToFileURL(`${process.cwd()}/`))
  }

  if (url.protocol !== 'file:') {
    throw new Error(
      `serverBuildFile must use the file: protocol (got ${url.protocol}). Remote URLs are not supported.`,
    )
  }
  return url
}
