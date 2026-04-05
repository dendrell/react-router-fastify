import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { ServeOptions } from 'node-cluster-serve'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  createRemixRequestHandler: vi.fn(() => vi.fn(async () => new Response('router response'))),
}))

vi.mock('react-router', () => ({
  createRequestHandler: mockState.createRemixRequestHandler,
}))

import { createServerRunner } from './server-runner.ts'

type TempModule = {
  dir: string
  filePath: string
}

async function createTempServerBuildModule(
  options: {
    publicPath?: string
    files?: Record<string, string>
  } = {},
): Promise<TempModule> {
  let dir = await mkdtemp(path.join(os.tmpdir(), 'rrf-runner-'))
  let clientDir = path.join(dir, 'client')
  let files = options.files ?? {}

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      let filePath = path.join(clientDir, relativePath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, contents, 'utf8')
    }),
  )

  let filePath = path.join(dir, 'server-build.mjs')
  await writeFile(
    filePath,
    [
      `export const publicPath = ${JSON.stringify(options.publicPath ?? '/')}`,
      `export const assetsBuildDirectory = ${JSON.stringify(clientDir)}`,
      "export default { marker: 'runner-build' }",
      '',
    ].join('\n'),
    'utf8',
  )

  return { dir, filePath }
}

describe('createServerRunner', () => {
  let tempDirs: string[] = []
  let apps: FastifyInstance[] = []

  beforeEach(() => {
    mockState.createRemixRequestHandler.mockReset()
    mockState.createRemixRequestHandler.mockImplementation(() =>
      vi.fn(async () => new Response('router response')),
    )
  })

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()))
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    apps = []
    tempDirs = []
    vi.restoreAllMocks()
  })

  it('imports the build, runs prepare, and returns a working Fastify instance', async () => {
    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let prepared = false
    let run = createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      prepare: async (app) => {
        prepared = true
        app.get('/health', async () => 'ok')
      },
    })

    let app = (await run({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    let response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(prepared).toBe(true)
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('ok')
    expect(mockState.createRemixRequestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        default: { marker: 'runner-build' },
      }),
      'production',
    )
  })

  it('uses the resolved host and port as the request origin by default', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(
      () =>
        vi.fn(async (request: Request) => {
          capturedRequest = request
          return new Response('ok')
        }) as any,
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let app = (await createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
    })({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    await app.inject({
      method: 'GET',
      url: '/resource?x=1',
    })

    expect(capturedRequest?.url).toBe('http://localhost:0/resource?x=1')
  })

  it('prefers an explicit origin over the resolved listen address', async () => {
    let capturedRequest: Request | undefined
    mockState.createRemixRequestHandler.mockImplementationOnce(
      () =>
        vi.fn(async (request: Request) => {
          capturedRequest = request
          return new Response('ok')
        }) as any,
    )

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let app = (await createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      origin: 'https://app.example.com',
    })({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    await app.inject({
      method: 'GET',
      url: '/resource?x=1',
    })

    expect(capturedRequest?.url).toBe('https://app.example.com/resource?x=1')
  })

  it('serves static assets under the public path and falls through on misses', async () => {
    let temp = await createTempServerBuildModule({
      publicPath: '/public/',
      files: {
        'assets/app.js': 'console.log("hello")',
        'favicon.ico': 'icon',
      },
    })
    tempDirs.push(temp.dir)

    let app = (await createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: true,
    })({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    let assetResponse = await app.inject({
      method: 'GET',
      url: '/public/assets/app.js',
    })
    let publicFileResponse = await app.inject({
      method: 'GET',
      url: '/public/favicon.ico',
    })
    let fallbackResponse = await app.inject({
      method: 'GET',
      url: '/public/missing.txt',
    })

    expect(assetResponse.statusCode).toBe(200)
    expect(assetResponse.body).toBe('console.log("hello")')
    expect(assetResponse.headers['cache-control']).toContain('immutable')
    expect(assetResponse.headers['cache-control']).toContain('max-age=31536000')
    expect(publicFileResponse.statusCode).toBe(200)
    expect(publicFileResponse.body).toBe('icon')
    expect(publicFileResponse.headers['cache-control']).toContain('max-age=3600')
    expect(fallbackResponse.statusCode).toBe(200)
    expect(fallbackResponse.body).toBe('router response')
  })

  it('allows overriding cache ages for assets and public files', async () => {
    let temp = await createTempServerBuildModule({
      publicPath: '/public/',
      files: {
        'assets/app.js': 'console.log("hello")',
        'favicon.ico': 'icon',
      },
    })
    tempDirs.push(temp.dir)

    let app = (await createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: true,
      assetMaxAge: '30d',
      publicFileMaxAge: '10m',
    })({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    let assetResponse = await app.inject({
      method: 'GET',
      url: '/public/assets/app.js',
    })
    let publicFileResponse = await app.inject({
      method: 'GET',
      url: '/public/favicon.ico',
    })

    expect(assetResponse.headers['cache-control']).toContain('max-age=2592000')
    expect(publicFileResponse.headers['cache-control']).toContain('max-age=600')
  })

  it('adds request timing and request logs when enabled', async () => {
    let consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    let temp = await createTempServerBuildModule()
    tempDirs.push(temp.dir)

    let app = (await createServerRunner(pathToFileURL(temp.filePath), {
      serveClientAssets: false,
      logRequests: true,
      serverTimingHeader: true,
    })({
      mode: 'production',
      host: 'localhost',
      port: 0,
    } as ServeOptions)) as FastifyInstance
    apps.push(app)

    let response = await app.inject({
      method: 'GET',
      url: '/timed',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['server-timing']).toMatch(/^total;dur=/)
    expect(consoleLog).toHaveBeenCalledWith(expect.stringMatching(/^GET \/timed 200 - /))
  })
})
