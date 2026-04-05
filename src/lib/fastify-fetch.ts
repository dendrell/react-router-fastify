// Adapted work from:
// - https://github.com/fastify/fastify-fetch (MIT License)
// - https://github.com/remix-run/remix/blob/main/packages/node-fetch-server (MIT License)

import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify'
import fp from 'fastify-plugin'
import { Readable } from 'node:stream'

/**
 * Creates a [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) object from the headers in a Node.js
 * [`http.IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage)/[`http2.Http2ServerRequest`](https://nodejs.org/api/http2.html#class-http2http2serverrequest).
 */
function createWebHeaders(req: FastifyRequest): Headers {
  let headers = new Headers()

  let rawHeaders = req.raw.rawHeaders
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].startsWith(':')) continue
    headers.append(rawHeaders[i], rawHeaders[i + 1])
  }

  return headers
}

/**
 * Creates a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object from
 *
 * - a [`http.IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage)/[`http.ServerResponse`](https://nodejs.org/api/http.html#class-httpserverresponse) pair
 * - a [`http2.Http2ServerRequest`](https://nodejs.org/api/http2.html#class-http2http2serverrequest)/[`http2.Http2ServerResponse`](https://nodejs.org/api/http2.html#class-http2http2serverresponse) pair
 */
function createWebRequest(
  origin: URL | undefined,
  req: FastifyRequest,
  res: FastifyReply,
): Request {
  let controller: AbortController | null = new AbortController()

  // Abort once we can no longer write a response if we have
  // not yet sent a response (i.e., `close` without `finish`)
  // `finish` -> done rendering the response
  // `close` -> response can no longer be written to
  res.raw.once('close', () => controller?.abort())
  res.raw.once('finish', () => (controller = null))

  let method = req.method ?? 'GET'
  let headers = createWebHeaders(req)
  let requestOrigin = new URL(origin ?? 'http://localhost')
  if ('encrypted' in req.socket && req.socket.encrypted) {
    requestOrigin.protocol = 'https:'
  }
  let url = new URL(req.url!, requestOrigin)

  let init: RequestInit = { method, headers, signal: controller.signal }

  if (method !== 'GET' && method !== 'HEAD') {
    let cleanup = () => {}
    init.body = new ReadableStream({
      start(streamController) {
        let closed = false
        const closeStream = () => {
          if (closed) return
          closed = true
          cleanup()
          streamController.close()
        }
        const errorStream = (error: Error) => {
          if (closed) return
          closed = true
          cleanup()
          streamController.error(error)
        }
        const onData = (chunk: Buffer) => {
          streamController.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        }
        const onEnd = () => {
          closeStream()
        }
        const onError = (error: Error) => {
          errorStream(error)
        }
        const onAbort = () => {
          errorStream(new Error('Request body aborted'))
        }
        const onClose = () => {
          if (!req.raw.complete) {
            errorStream(new Error('Request body closed before completion'))
          }
        }
        cleanup = () => {
          req.raw.off('data', onData)
          req.raw.off('end', onEnd)
          req.raw.off('error', onError)
          req.raw.off('aborted', onAbort)
          req.raw.off('close', onClose)
        }
        req.raw.on('data', onData)
        req.raw.once('end', onEnd)
        req.raw.once('error', onError)
        req.raw.once('aborted', onAbort)
        req.raw.once('close', onClose)
      },
      cancel() {
        cleanup()
      },
    })

    // init.duplex = 'half' must be set when body is a ReadableStream, and Node follows the spec.
    // However, this property is not defined in the TypeScript types for RequestInit, so we have
    // to cast it here in order to set it without a type error.
    // See https://fetch.spec.whatwg.org/#dom-requestinit-duplex
    ;(init as { duplex: 'half' }).duplex = 'half'
  }

  return new Request(url, init)
}

async function sendWebResponse(fastifyReply: FastifyReply, webResponse: Response) {
  if (!(webResponse instanceof Response)) {
    throw new Error('Handler must return a Response object')
  }

  fastifyReply.status(webResponse.status)

  for (const [key, value] of webResponse.headers) {
    fastifyReply.header(key, value)
  }

  if (!webResponse.body) {
    return fastifyReply.send()
  }

  // Stream the body instead of buffering it all into memory
  return fastifyReply.send(Readable.fromWeb(webResponse.body))
}

const methods = ['all', 'get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

export type FetchContext = {
  log: FastifyBaseLogger
  server: FastifyInstance
  params: Record<string, string>
  query: Record<string, string>
  request: FastifyRequest
  reply: FastifyReply
}

type MaybePromise<T> = T | Promise<T>
export type FetchHandler = (request: Request, ctx: FetchContext) => MaybePromise<Response | void>

export type FetchMethod = (typeof methods)[number]
export type FetchPlugin = Record<FetchMethod, (path: string, handler: FetchHandler) => void>

export type FastifyFetchOptions = {
  origin?: URL
}
const fastifyFetchPlugin: FastifyPluginCallback<FastifyFetchOptions> = (
  fastify: FastifyInstance,
  options: FastifyFetchOptions,
  done,
) => {
  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', function (_request, payload, done) {
    done(null, payload)
  })

  const fetchPlugin = {} as FetchPlugin

  for (const method of methods) {
    fetchPlugin[method] = (path: string, handler: FetchHandler) => {
      fastify[method](path, async (request, reply) => {
        const webRequest = createWebRequest(options.origin, request, reply)
        const ctx: FetchContext = {
          log: request.log,
          server: fastify,
          params: (request.params ?? {}) as Record<string, string>,
          query: (request.query ?? {}) as Record<string, string>,
          request,
          reply,
        }

        const webResponse = await handler(webRequest, ctx)
        if (webResponse) {
          await sendWebResponse(reply, webResponse)
        }
      })
    }
  }

  fastify.decorate('fetch', fetchPlugin)
  done()
}

export const fastifyFetch = fp(fastifyFetchPlugin, {
  name: 'fastify-fetch',
})

declare module 'fastify' {
  interface FastifyInstance {
    fetch: FetchPlugin
  }
}
