import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServeOptions } from 'node-cluster-serve'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const app = {
    register: vi.fn(async () => undefined),
    addHook: vi.fn(),
    all: vi.fn(),
    listen: vi.fn(async () => undefined),
  }
  const fastifyFactory = vi.fn(() => app)
  const createRemixRequestHandler = vi.fn(() => vi.fn(async () => new Response('ok')))
  const createRequest = vi.fn(() => ({ marker: 'node-request' }))
  const sendResponse = vi.fn(async () => undefined)
  const plugin = {}
  return { app, fastifyFactory, createRemixRequestHandler, createRequest, sendResponse, plugin }
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
  default: mockState.plugin,
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
  await writeFile(filePath, "export default { marker: 'runner-build' }\n", 'utf8')
  return { dir, filePath }
}

describe('createServerRunner startup wiring', () => {
  let tempDirs: string[] = []
  let originalCwd = process.cwd()

  beforeEach(() => {
    mockState.fastifyFactory.mockClear()
    mockState.createRemixRequestHandler.mockClear()
    mockState.app.register.mockClear()
    mockState.app.addHook.mockClear()
    mockState.app.all.mockClear()
    mockState.app.listen.mockClear()
    mockState.createRequest.mockClear()
    mockState.sendResponse.mockClear()
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
    expect(mockState.app.register).toHaveBeenCalledWith(mockState.plugin, {
      root: path.resolve('public'),
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

  it('adds Server-Timing header to Remix responses when enabled', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      serverTimingHeader: true,
    })

    await run({
      mode: 'production',
      host: '127.0.0.1',
      port: 4314,
    } as ServeOptions)

    let wildcardHandler = (mockState.app.all.mock.calls.find((call) => call[0] === '/*') ??
      [])[1] as ((request: any, reply: any) => Promise<void>) | undefined
    expect(wildcardHandler).toBeTypeOf('function')

    let raw = {
      url: '/resource',
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

    await wildcardHandler?.({ raw, url: '/resource', method: 'GET' }, reply)

    expect(mockState.sendResponse).toHaveBeenCalledTimes(1)
    let response = firstCall(mockState.sendResponse)[1] as Response
    expect(response.headers.get('Server-Timing')).toMatch(/^total;dur=\d+$/)
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
