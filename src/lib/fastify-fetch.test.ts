import fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { fastifyFetch } from './fastify-fetch.ts'

describe('fastifyFetch', () => {
  let app = fastify()

  afterEach(async () => {
    await app.close()
    app = fastify()
  })

  it('decorates the root instance after registration', async () => {
    await app.register(fastifyFetch)

    expect(app.fetch.all).toBeTypeOf('function')
  })

  it('handles routes defined through the fetch decorator', async () => {
    await app.register(fastifyFetch)

    app.fetch.all('/health', async (request) => {
      return new Response(JSON.stringify({ method: request.method, ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })

    let response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      method: 'GET',
      ok: true,
    })
  })

  it('uses the configured origin when building the web request', async () => {
    await app.register(fastifyFetch, {
      origin: new URL('https://app.example.com'),
    })

    app.fetch.all('/request-url', async (request) => {
      return Response.json({ url: request.url })
    })

    let response = await app.inject({
      method: 'GET',
      url: '/request-url?x=1',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      url: 'https://app.example.com/request-url?x=1',
    })
  })

  it('streams response bodies without buffering them first', async () => {
    await app.register(fastifyFetch)

    app.fetch.all('/stream', async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('hello '))
            controller.enqueue(new TextEncoder().encode('world'))
            controller.close()
          },
        }),
      )
    })

    let response = await app.inject({
      method: 'GET',
      url: '/stream',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('hello world')
  })
})
