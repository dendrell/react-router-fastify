import fastifyStatic from '@fastify/static'
import { createRequest, sendResponse } from '@remix-run/node-fetch-server'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastify from 'fastify'
import type { ServeFunction, ServerMode } from 'node-cluster-serve'
import { stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { createRequestHandler as createRemixRequestHandler, type ServerBuild } from 'react-router'
import {
  getPathnameWithinPublicPath,
  normalizePublicPath,
  resolvePathnameWithinRoot,
  resolveServerBuildFileUrl,
} from './path-utils.ts'

type CreateFastifyAppOptions = {
  serveClientAssets: boolean
  assetsMaxAge?: string
  logRequests?: boolean
  serverTimingHeader?: boolean
  bodySizeLimit?: number
}
type CreateServerRunnerOptions = CreateFastifyAppOptions & {
  prepare?: (app: FastifyInstance) => Promise<void>
  mode?: ServerMode
  port?: number
  host?: string
}
type RequestHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

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

function createBufferedRequest(req: FastifyRequest, reply: FastifyReply) {
  let body = req.body
  let webRequest = createRequest(req.raw, reply.raw)

  if (
    body == null ||
    (typeof body !== 'string' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer))
  ) {
    return webRequest
  }

  return new Request(webRequest.url, {
    method: webRequest.method,
    headers: webRequest.headers,
    body,
  })
}

function createRequestHandler({
  build,
  mode = process.env.NODE_ENV,
}: {
  build: ServerBuild | (() => Promise<ServerBuild>)
  mode?: string
}): RequestHandler {
  const handleRemixRequest = createRemixRequestHandler(build, mode)

  return async (req, reply) => {
    reply.hijack()
    try {
      const webRequest = createBufferedRequest(req, reply)
      const webResponse = await handleRemixRequest(webRequest)
      await sendResponse(reply.raw, webResponse)
    } catch (error) {
      if (!reply.raw.writableEnded) {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500
          reply.raw.setHeader('content-type', 'text/plain; charset=utf-8')
          reply.raw.end('Internal Server Error')
        } else {
          reply.raw.end()
        }
      }
      throw error
    }
  }
}

const DEFAULT_BODY_SIZE_LIMIT = 1024 * 1024 * 4 // 4MB

async function createFastifyApp(
  handleRequest: RequestHandler,
  build: ServerBuild,
  options: CreateFastifyAppOptions,
) {
  const bodySizeLimit = options.bodySizeLimit ?? DEFAULT_BODY_SIZE_LIMIT
  const staticRoot = path.resolve(build.assetsBuildDirectory)
  const publicPath = normalizePublicPath(build.publicPath)
  const requestTimeMap = new WeakMap<IncomingMessage, number>()
  const timingEnabled = options.serverTimingHeader || options.logRequests

  const app = fastify()

  // Buffer urlencoded payloads so React Router can parse them via `request.formData()`.
  app.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    { parseAs: 'buffer', bodyLimit: bodySizeLimit },
    async (_request: FastifyRequest, payload: Buffer) => payload,
  )

  app.register(fastifyStatic, {
    root: staticRoot,
    serve: false,
  })

  if (options.logRequests) {
    app.addHook('onRequest', async (request) => {
      if (timingEnabled) {
        requestTimeMap.set(request.raw, performance.now())
      }
    })

    app.addHook('onResponse', async (request, reply) => {
      if (timingEnabled) {
        const startedAt = requestTimeMap.get(request.raw)
        const elapsedMs = startedAt ? (performance.now() - startedAt).toFixed(2) : -1
        if (options.serverTimingHeader) {
          reply.raw.setHeader('Server-Timing', `total;dur=${elapsedMs}`)
        }
        if (options.logRequests) {
          const pathname = getPathname(request)
          console.log(`${request.method} ${pathname} ${reply.statusCode} - ${elapsedMs} ms`)
        }
        requestTimeMap.delete(request.raw)
      }
    })
  }

  app.all('/*', async (request, reply) => {
    let pathname = getPathname(request)

    if (options.serveClientAssets) {
      let relativePathname = getPathnameWithinPublicPath(pathname, publicPath)
      if (relativePathname) {
        let isAssetsPath = relativePathname === 'assets' || relativePathname.startsWith('assets/')

        let served = await maybeServeStaticFile(reply, {
          pathname: relativePathname,
          root: staticRoot,
          immutable: isAssetsPath,
          maxAge: isAssetsPath ? (options.assetsMaxAge ?? '1y') : undefined,
        })
        if (served) {
          return
        }
      }
    }

    await handleRequest(request, reply)
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
    const serverHost = options.host ?? serveOptions.host

    const buildFile = resolveServerBuildFileUrl(serverBundleFile)
    const build: ServerBuild = await import(buildFile.href)
    const handleRequest = createRequestHandler({
      build,
      mode: serverMode,
    })

    const { prepare, ...appOptions } = options
    const app = await createFastifyApp(handleRequest, build, appOptions)
    await prepare?.(app)
    await app.listen({
      port: serverPort,
      host: serverHost,
    })
    return app
  }
}
