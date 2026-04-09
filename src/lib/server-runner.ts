import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastify from 'fastify'
import type { ServeFunction, ServerMode } from 'node-cluster-serve'
import { stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { createRequestHandler as createRemixRequestHandler, type ServerBuild } from 'react-router'
import { fastifyFetch } from './fastify-fetch.ts'
import {
  getPathnameWithinPublicPath,
  normalizePublicPath,
  resolvePathnameWithinRoot,
  resolveServerBuildFileUrl,
} from './path-utils.ts'

type CreateFastifyAppOptions = {
  serveClientAssets: boolean
  assetMaxAge?: string
  publicFileMaxAge?: string
  logRequests?: boolean
  serverTimingHeader?: boolean
}

type CreateServerRunnerOptions = CreateFastifyAppOptions & {
  app?: FastifyInstance
  prepare?: (app: FastifyInstance) => Promise<void>
  mode?: ServerMode
  port?: number
  host?: string
  origin?: string | URL
}

function createRequestOrigin(host: string, port?: number): URL {
  let normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  let origin = `http://${normalizedHost}`
  if (port !== undefined) {
    origin += `:${port}`
  }
  return new URL(origin)
}

function resolveRequestOrigin(origin: string | URL): URL {
  let parsedOrigin = origin instanceof URL ? new URL(origin) : new URL(origin)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    throw new Error(`origin must use http: or https: (got ${parsedOrigin.protocol})`)
  }
  return new URL(parsedOrigin.origin)
}

async function fileExists(root: string, pathname: string) {
  let filePath = path.join(root, pathname)
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

function getPathname(request: FastifyRequest) {
  return new URL(request.raw.url ?? request.url, 'http://localhost').pathname
}

async function maybeServeStaticFile(
  reply: FastifyReply,
  options: {
    pathname: string
    root: string
    maxAge?: string
    immutable?: boolean
  },
) {
  let resolvedPathname = resolvePathnameWithinRoot(options.root, options.pathname)
  if (!resolvedPathname) {
    return false
  }

  if (!(await fileExists(options.root, resolvedPathname))) {
    return false
  }

  await reply.sendFile(resolvedPathname, options.root, {
    immutable: options.immutable,
    maxAge: options.maxAge,
  })
  return true
}

const handleStaticRequest = async (
  staticRoot: string,
  publicPath: string,
  request: FastifyRequest,
  reply: FastifyReply,
  options: Pick<CreateFastifyAppOptions, 'assetMaxAge' | 'publicFileMaxAge'>,
) => {
  let pathname = getPathname(request)

  let relativePathname = getPathnameWithinPublicPath(pathname, publicPath)
  if (relativePathname) {
    let isAssetsPath = relativePathname === 'assets' || relativePathname.startsWith('assets/')

    let served = await maybeServeStaticFile(reply, {
      pathname: relativePathname,
      root: staticRoot,
      immutable: isAssetsPath,
      maxAge: isAssetsPath ? (options.assetMaxAge ?? '1y') : (options.publicFileMaxAge ?? '1h'),
    })
    if (served) {
      return true
    }
  }

  return false
}

type RSCServerBuild = {
  fetch: (request: Request) => Response
  publicPath: string
  assetsBuildDirectory: string
}

function isRSCServerBuild(build: ServerBuild | RSCServerBuild): build is RSCServerBuild {
  return 'fetch' in build && typeof build.fetch === 'function'
}

async function createFastifyApp(
  existingApp: FastifyInstance | undefined,
  build: ServerBuild,
  mode: ServerMode | undefined,
  requestOrigin: URL,
  options: CreateServerRunnerOptions,
) {
  const staticRoot = path.resolve(build.assetsBuildDirectory)
  const publicPath = normalizePublicPath(build.publicPath)
  const requestTimeMap = new WeakMap<IncomingMessage, number>()
  const needsHooks = options.serverTimingHeader || options.logRequests

  const app = existingApp ?? fastify()
  await app.register(fastifyFetch, {
    origin: requestOrigin,
  })

  if (needsHooks) {
    app.addHook('onRequest', async (request) => {
      requestTimeMap.set(request.raw, performance.now())
    })

    app.addHook('onSend', async (request, reply, payload) => {
      const startedAt = requestTimeMap.get(request.raw)
      if (!startedAt) return payload
      const elapsedMs = startedAt ? (performance.now() - startedAt).toFixed(2) : -1

      if (options.serverTimingHeader) {
        reply.header('Server-Timing', `total;dur=${elapsedMs}`)
      }

      if (options.logRequests) {
        const pathname = getPathname(request)
        console.log(`${request.method} ${pathname} ${reply.statusCode} - ${elapsedMs} ms`)
      }
      requestTimeMap.delete(request.raw)
      return payload
    })
  }

  if (options.serveClientAssets) {
    app.register(fastifyStatic, {
      root: staticRoot,
      serve: false,
    })
  }

  const handleRemixRequest = createRemixRequestHandler(build, mode)
  app.fetch.all('/*', async (request, ctx) => {
    if (
      options.serveClientAssets &&
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
    ) {
      const served = await handleStaticRequest(staticRoot, publicPath, ctx.request, ctx.reply, {
        assetMaxAge: options.assetMaxAge,
        publicFileMaxAge: options.publicFileMaxAge,
      })
      if (served) {
        return
      }
    }
    return handleRemixRequest(request)
  })

  return app
}

export function createServerRunner(
  serverBundleFile: string | URL = './build/server/index.js',
  options: CreateServerRunnerOptions,
): ServeFunction {
  return async (serveOptions) => {
    const serverMode = options.mode ?? serveOptions.mode
    const serverPort = options.port ?? serveOptions.port
    const serverHost = options.host ?? serveOptions.host ?? 'localhost'

    const buildFile = resolveServerBuildFileUrl(serverBundleFile)
    const build: ServerBuild = await import(buildFile.href)

    if (isRSCServerBuild(build)) {
      throw new Error('RSC Server Builds are not supported yet.')
    }

    const requestOrigin = options.origin
      ? resolveRequestOrigin(options.origin)
      : createRequestOrigin(serverHost, serverPort)

    const app = await createFastifyApp(options.app, build, serverMode, requestOrigin, options)

    await options.prepare?.(app)
    await app.listen({
      port: serverPort,
      host: serverHost,
    })
    return app
  }
}
