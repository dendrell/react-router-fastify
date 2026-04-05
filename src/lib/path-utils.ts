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

export function normalizePublicPath(publicPath: string): string {
  let normalized = `/${publicPath}`.replace(/\/+/g, '/')
  if (!normalized.endsWith('/')) {
    normalized = `${normalized}/`
  }
  return normalized
}

export function getPathnameWithinPublicPath(pathname: string, publicPath: string): string | null {
  let normalizedPublicPath = normalizePublicPath(publicPath)
  if (normalizedPublicPath === '/') {
    return pathname.replace(/^\/+/, '')
  }

  let publicPrefix = normalizedPublicPath.slice(0, -1)
  if (pathname !== publicPrefix && !pathname.startsWith(`${publicPrefix}/`)) {
    return null
  }

  return pathname.slice(publicPrefix.length).replace(/^\/+/, '')
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
