import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServeOptions } from 'node-cluster-serve'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const app = {
    addContentTypeParser: vi.fn(),
    register: vi.fn(async () => undefined),
    addHook: vi.fn(),
    all: vi.fn(),
    listen: vi.fn(async () => undefined),
  }
  const fastifyFactory = vi.fn(() => app)
  const createRemixRequestHandler = vi.fn(() =>
    vi.fn(async (_request?: Request) => new Response('ok')),
  )
  const createRequest = vi.fn((req: any, _rawReply: any) => createRequestFromNodeRequest(req))
  const sendResponse = vi.fn(async (rawReply: any, response: Response | undefined) => {
    response?.headers.forEach((value, key) => {
      rawReply.setHeader?.(key, value)
    })
    rawReply.statusCode = response?.status ?? 200
    rawReply.headersSent = true
    rawReply.writableEnded = true
    await rawReply.end?.()
  })

  function createRequestFromNodeRequest(req: any) {
    let method = req?.method ?? 'GET'
    let host = req?.headers?.host ?? 'localhost'
    let url = `http://${host}${req?.url ?? '/'}`
    let headers = new Headers(req?.headers ?? {})
    let body: string | undefined
    if (typeof req?.body === 'string') {
      body = req.body
    } else if (
      req?.body &&
      typeof req.body === 'object' &&
      headers.get('content-type')?.includes('application/x-www-form-urlencoded')
    ) {
      body = new URLSearchParams(req.body as Record<string, string>).toString()
    }

    return new Request(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
    })
  }

  const staticPlugin = {}
  return {
    app,
    fastifyFactory,
    createRemixRequestHandler,
    createRequest,
    sendResponse,
    staticPlugin,
  }
})

vi.mock('fastify', () => ({
  default: mockState.fastifyFactory,
}))

vi.mock('react-router', () => ({
  createRequestHandler: mockState.createRemixRequestHandler,
}))

vi.mock('@remix-run/node-fetch-server', () => ({
  createRequest: mockState.createRequest,
  sendResponse: mockState.sendResponse,
}))

vi.mock('@fastify/static', () => ({
  default: mockState.staticPlugin,
}))

import { createServerRunner } from './server-runner.ts'

type TempModule = {
  dir: string
  filePath: string
}

function firstCall(mockFn: { mock: { calls: unknown[][] } }) {
  return mockFn.mock.calls[0] ?? []
}

async function createTempServerBuildModule(fileName = 'server-build.mjs'): Promise<TempModule> {
  let dir = await mkdtemp(path.join(os.tmpdir(), 'rrf-runner-'))
  let filePath = path.join(dir, fileName)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    "export const publicPath = '/'\nexport const assetsBuildDirectory = './build/client'\nexport default { marker: 'runner-build' }\n",
    'utf8',
  )
  return { dir, filePath }
}

describe('createServerRunner startup wiring', () => {
  let tempDirs: string[] = []
  let originalCwd = process.cwd()

  beforeEach(() => {
    mockState.fastifyFactory.mockClear()
    mockState.createRemixRequestHandler.mockClear()
    mockState.createRequest.mockClear()
    mockState.sendResponse.mockClear()
    mockState.app.addContentTypeParser.mockClear()
    mockState.app.register.mockClear()
    mockState.app.addHook.mockClear()
    mockState.app.all.mockClear()
    mockState.app.listen.mockClear()
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('imports build module, creates handler, runs onBeforeStart, then listens', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let onBeforeStart = vi.fn(async () => undefined)
    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: true,
      prepare: onBeforeStart,
    })

    let returnedApp = await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4310,
    } as ServeOptions)

    expect(returnedApp).toBe(mockState.app)
    expect(mockState.fastifyFactory).toHaveBeenCalledTimes(1)
    expect(mockState.app.addContentTypeParser).toHaveBeenCalledWith(
      ['application/x-www-form-urlencoded', 'multipart/form-data'],
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 4 },
      expect.any(Function),
    )
    expect(mockState.app.register).toHaveBeenNthCalledWith(1, mockState.staticPlugin, {
      root: path.resolve('build/client'),
      serve: false,
    })
    expect(mockState.createRemixRequestHandler).toHaveBeenCalledTimes(1)
    expect(firstCall(mockState.createRemixRequestHandler)[0]).toMatchObject({
      default: { marker: 'runner-build' },
    })
    expect(firstCall(mockState.createRemixRequestHandler)[1]).toBe('production')
    expect(onBeforeStart).toHaveBeenCalledWith(mockState.app)
    expect(onBeforeStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.app.listen.mock.invocationCallOrder[0],
    )
    expect(mockState.app.listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 4310 })
  })

  it('does not register request logging hooks by default', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4312,
    } as ServeOptions)

    expect(mockState.app.addHook).not.toHaveBeenCalled()
  })

  it('registers request logging hooks when logRequests is enabled', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      logRequests: true,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4313,
    } as ServeOptions)

    expect(mockState.app.addHook).toHaveBeenCalledTimes(2)
    let hookCalls = mockState.app.addHook.mock.calls as unknown[][]
    expect((hookCalls[0] ?? [])[0]).toBe('onRequest')
    expect((hookCalls[1] ?? [])[0]).toBe('onResponse')
  })

  it('registers timing hooks and sets Server-Timing when serverTimingHeader is enabled', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      serverTimingHeader: true,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4319,
    } as ServeOptions)

    expect(mockState.app.addHook).toHaveBeenCalledTimes(2)
    let hookCalls = mockState.app.addHook.mock.calls as unknown[][]
    let onRequest = hookCalls.find((call) => call[0] === 'onRequest')?.[1] as
      | ((request: any) => Promise<void>)
      | undefined
    let onResponse = hookCalls.find((call) => call[0] === 'onResponse')?.[1] as
      | ((request: any, reply: any) => Promise<void>)
      | undefined
    expect(onRequest).toBeTypeOf('function')
    expect(onResponse).toBeTypeOf('function')

    let raw = {
      url: '/resource',
      setHeader: vi.fn(),
    }
    let request = {
      raw,
      url: '/resource',
      method: 'GET',
    }
    let reply = {
      raw,
      statusCode: 200,
    }

    await onRequest?.(request)
    await onResponse?.(request, reply)

    expect(raw.setHeader).toHaveBeenCalledWith(
      'Server-Timing',
      expect.stringMatching(/^total;dur=/),
    )
  })

  it('resolves relative serverBuildFile from process.cwd()', async () => {
    let temp = await createTempServerBuildModule(path.join('build', 'server', 'index.mjs'))
    tempDirs.push(temp.dir)
    process.chdir(temp.dir)

    let run = createServerRunner('./build/server/index.mjs', {
      serveClientAssets: false,
    })

    await run({
      mode: 'development',
      host: '127.0.0.1',
      port: 4311,
    } as ServeOptions)

    expect(mockState.createRemixRequestHandler).toHaveBeenCalledTimes(1)
    let buildArg = firstCall(mockState.createRemixRequestHandler)[0] as {
      default: unknown
    }
    expect(buildArg.default).toMatchObject({ marker: 'runner-build' })

    let expectedUrl = pathToFileURL(path.join(temp.dir, 'build', 'server', 'index.mjs')).href
    expect(fileURLToPath(expectedUrl)).toBe(path.join(temp.dir, 'build', 'server', 'index.mjs'))
  })

  it('forwards buffered form bodies to the remix request handler', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async (request?: Request) => {
        capturedRequest = request
        return new Response('ok')
      }),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4317,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      socket: { encrypted: false },
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await wildcardHandler?.(
      {
        raw,
        url: '/resource',
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: Buffer.from('intent=reroll-catch-challenge'),
      },
      reply,
    )

    expect(mockState.createRequest).toHaveBeenCalledTimes(1)
    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    expect(capturedRequest).toBeDefined()
    expect((await capturedRequest?.formData())?.get('intent')).toBe('reroll-catch-challenge')
  })

  it('forwards buffered multipart form bodies to the remix request handler', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async (request?: Request) => {
        capturedRequest = request
        return new Response('ok')
      }),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4319,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let boundary = '----rrf-boundary'
    let multipartBody = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="intent"',
        '',
        'reroll-catch-challenge',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    )

    let raw = {
      url: '/resource',
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      socket: { encrypted: false },
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await wildcardHandler?.(
      {
        raw,
        url: '/resource',
        method: 'POST',
        headers: raw.headers,
        body: multipartBody,
      },
      reply,
    )

    expect(mockState.createRequest).toHaveBeenCalledTimes(1)
    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    expect(capturedRequest).toBeDefined()
    expect((await capturedRequest?.formData())?.get('intent')).toBe('reroll-catch-challenge')
  })

  it('uses node-fetch-server createRequest for non-buffered requests', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async (request?: Request) => {
        capturedRequest = request
        return new Response('ok')
      }),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4318,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      socket: { encrypted: false },
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await wildcardHandler?.(
      {
        raw,
        url: '/resource',
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
      },
      reply,
    )

    expect(mockState.createRequest).toHaveBeenCalledTimes(1)
    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    expect(capturedRequest).toBeDefined()
  })

  it('passes through text/plain requests via node-fetch-server createRequest', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async (request?: Request) => {
        capturedRequest = request
        return new Response('ok')
      }),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4320,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': 'text/plain;charset=UTF-8',
      },
      body: 'hello world',
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      socket: { encrypted: false },
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await wildcardHandler?.(
      {
        raw,
        url: '/resource',
        method: 'POST',
        headers: raw.headers,
      },
      reply,
    )

    expect(mockState.createRequest).toHaveBeenCalledTimes(1)
    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    expect(capturedRequest).toBeDefined()
    expect(await capturedRequest?.text()).toBe('hello world')
  })

  it('passes through application/json requests via node-fetch-server createRequest', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async (request?: Request) => {
        capturedRequest = request
        return new Response('ok')
      }),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4321,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: '{"intent":"reroll-catch-challenge"}',
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
      socket: { encrypted: false },
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await wildcardHandler?.(
      {
        raw,
        url: '/resource',
        method: 'POST',
        headers: raw.headers,
      },
      reply,
    )

    expect(mockState.createRequest).toHaveBeenCalledTimes(1)
    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    expect(capturedRequest).toBeDefined()
    expect(await capturedRequest?.json()).toEqual({ intent: 'reroll-catch-challenge' })
  })

  it('uses a custom bodySizeLimit for buffered parsers', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      bodySizeLimit: 123_456,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4322,
    } as ServeOptions)

    expect(mockState.app.addContentTypeParser).toHaveBeenCalledWith(
      ['application/x-www-form-urlencoded', 'multipart/form-data'],
      { parseAs: 'buffer', bodyLimit: 123_456 },
      expect.any(Function),
    )
  })

  it('writes safe 500 fallback when hijacked handler throws', async () => {
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async () => Promise.reject(new Error('boom'))),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4315,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'GET',
      headers: {},
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await expect(
      wildcardHandler?.({ raw, url: '/resource', method: 'GET' }, reply),
    ).rejects.toThrow('boom')
    expect(raw.statusCode).toBe(500)
    expect(raw.setHeader).toHaveBeenCalledWith('content-type', 'text/plain; charset=utf-8')
    expect(raw.end).toHaveBeenCalledWith('Internal Server Error')
  })

  it('ends the response when headers were already sent and hijacked handler throws', async () => {
    mockState.createRemixRequestHandler.mockImplementationOnce(() =>
      vi.fn(async () => Promise.reject(new Error('boom-after-headers'))),
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4316,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined

    let raw = {
      url: '/resource',
      method: 'GET',
      headers: {},
      headersSent: true,
      writableEnded: false,
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    }

    let reply = {
      raw,
      hijack: vi.fn(),
      sendFile: vi.fn(async () => {
        throw { statusCode: 404 }
      }),
      callNotFound: vi.fn(),
    }

    await expect(
      wildcardHandler?.({ raw, url: '/resource', method: 'GET' }, reply),
    ).rejects.toThrow('boom-after-headers')
    expect(raw.setHeader).not.toHaveBeenCalled()
    expect(raw.end).toHaveBeenCalledWith()
  })
})
