import fastifyStatic from '@fastify/static'
import { createRequest, sendResponse } from '@remix-run/node-fetch-server'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastify from 'fastify'
import type { ClosableServer, ServeOptions, ServerMode } from 'node-cluster-serve'
import { stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import type { ServerBuild } from 'react-router'
import { createRequestHandler as createRemixRequestHandler } from 'react-router'
import { resolvePathnameWithinRoot, resolveServerBuildFileUrl } from './path-utils.ts'

type MaybePromise<T> = T | Promise<T>
type ContextType = Parameters<ReturnType<typeof createRemixRequestHandler>>[1]

type GetLoadContextFunction = (
  request: FastifyRequest,
  reply: FastifyReply,
) => MaybePromise<ContextType>

type RequestHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

function createRequestHandler({
  build,
  getLoadContext,
  mode = process.env.NODE_ENV,
  serverTimingHeader = false,
}: {
  build: ServerBuild | (() => Promise<ServerBuild>)
  getLoadContext?: GetLoadContextFunction
  mode?: string
  serverTimingHeader?: boolean
}): RequestHandler {
  let handleRequest = createRemixRequestHandler(build, mode)

  return async (request, reply) => {
    let startedAt = Date.now()
    reply.hijack()

    try {
      let nodeRequest = createRequest(request.raw, reply.raw)
      let loadContext = await getLoadContext?.(request, reply)
      let response = await handleRequest(nodeRequest, loadContext)

      if (serverTimingHeader) {
        let duration = Date.now() - startedAt
        response.headers.set('Server-Timing', `total;dur=${duration}`)
      }

      await sendResponse(reply.raw, response)
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

async function fileExists(root: string, pathname: string) {
  let filePath = path.join(root, pathname)
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
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

function getPathname(request: FastifyRequest) {
  return new URL(request.raw.url ?? request.url, 'http://localhost').pathname.replace(/^\/+/, '')
}

type CreateAppOptions = {
  serveClientAssets: boolean
  assetsMaxAge?: string
  logRequests?: boolean
  serverTimingHeader?: boolean
}

async function createApp(getHandler: () => Promise<RequestHandler>, options: CreateAppOptions) {
  const publicRoot = path.resolve('public')
  const clientRoot = path.resolve('build/client')
  const clientAssetsRoot = path.resolve('build/client/assets')
  const requestStartedAt = new WeakMap<IncomingMessage, number>()

  const app = fastify()

  await app.register(fastifyStatic, {
    root: publicRoot,
    serve: false,
  })

  if (options.logRequests) {
    app.addHook('onRequest', async (request) => {
      requestStartedAt.set(request.raw, performance.now())
    })

    app.addHook('onResponse', async (request, reply) => {
      let startedAt = requestStartedAt.get(request.raw) ?? performance.now()
      let elapsedMs = (performance.now() - startedAt).toFixed(2)
      let pathname = new URL(request.raw.url ?? request.url, 'http://localhost').pathname
      console.log(`${request.method} ${pathname} ${reply.statusCode} - ${elapsedMs} ms`)
    })
  }

  if (options.serveClientAssets) {
    app.all('/assets/*', async (request, reply) => {
      let assetPath = (request.params as { '*': string })['*']
      let served = await maybeServeStaticFile(reply, {
        pathname: assetPath,
        root: clientAssetsRoot,
        immutable: true,
        maxAge: options.assetsMaxAge ?? '1y',
      })

      if (!served) {
        return reply.callNotFound()
      }
    })
  }

  app.all('/*', async (request, reply) => {
    let pathname = getPathname(request)

    if (await maybeServeStaticFile(reply, { pathname, root: publicRoot })) {
      return
    }

    if (
      options.serveClientAssets &&
      (await maybeServeStaticFile(reply, {
        pathname,
        root: clientRoot,
      }))
    ) {
      return
    }

    const handler = await getHandler()
    await handler(request, reply)
  })

  return app
}

export function createServerRunner(
  serverBundleFile: string | URL = './build/server/index.js',
  options: CreateAppOptions & {
    prepare?: (app: FastifyInstance) => Promise<void>
    mode?: ServerMode
    port?: number
    host?: string
  },
) {
  return async (serveOptions: ServeOptions): Promise<ClosableServer> => {
    const serverMode = options.mode ?? serveOptions.mode
    const serverPort = options.port ?? serveOptions.port
    const serverHost = options.host ?? serveOptions.host

    const buildFile = resolveServerBuildFileUrl(serverBundleFile)
    const build = await import(buildFile.href)
    const handleRequest = createRequestHandler({
      build,
      mode: serverMode,
      serverTimingHeader: options.serverTimingHeader,
    })

    const { prepare, ...appOptions } = options
    const app = await createApp(async () => handleRequest, appOptions)
    await prepare?.(app)
    await app.listen({
      port: serverPort,
      host: serverHost,
    })
    return app
  }
}
