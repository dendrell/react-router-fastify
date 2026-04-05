# react-router-fastify

Fastify adapter for React Router server builds.

It wraps a React Router server build with a Fastify app, optionally serves the built client files,
and returns a runner function that works with
[`node-cluster-serve`](https://github.com/itsjavi/node-cluster-serve) or direct startup code.

This package is for production-style server builds. It is not a Fastify development server.

## Install

```bash
pnpm add react-router-fastify fastify react-router
```

If you use the cluster runner:

```bash
pnpm add node-cluster-serve
```

## Quick start

```ts
// server.ts
import { createServerRunner } from 'react-router-fastify'

export default createServerRunner(new URL('./build/server/index.js', import.meta.url), {
  serveClientAssets: true,
  assetMaxAge: '1y',
  publicFileMaxAge: '1h',
  logRequests: true,
  serverTimingHeader: true,
  origin: process.env.PUBLIC_ORIGIN,
  prepare: async (app) => {
    app.get('/api/hello', async () => {
      return { message: 'Hello World' }
    })
  },
})
```

Run it with `node-cluster-serve`:

```bash
node-cluster-serve ./server.ts --port 3000 --workerCount 4
```

Or run it directly:

```ts
import { createServerRunner } from 'react-router-fastify'

let run = createServerRunner('./build/server/index.js', {
  serveClientAssets: true,
})

await run({
  mode: 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
})
```

## API

### `createServerRunner(serverBundleFile?, options)`

```ts
import type { FastifyInstance } from 'fastify'
import type { ServeFunction, ServerMode } from 'node-cluster-serve'

type CreateServerRunnerOptions = {
  serveClientAssets: boolean
  assetMaxAge?: string
  publicFileMaxAge?: string
  logRequests?: boolean
  serverTimingHeader?: boolean
  prepare?: (app: FastifyInstance) => Promise<void>
  mode?: ServerMode
  port?: number
  host?: string
  origin?: string | URL
}

declare function createServerRunner(
  serverBundleFile?: string | URL,
  options: CreateServerRunnerOptions,
): ServeFunction
```

`serverBundleFile`

- Path or `file:` URL to the React Router server build module.
- Defaults to `./build/server/index.js`.
- String paths are resolved from `process.cwd()`.

`options.serveClientAssets`

- Enables static file serving from `build.assetsBuildDirectory`.
- Static URLs are scoped to `build.publicPath`.
- Requests under `<publicPath>/assets/*` get immutable cache headers.

`options.assetMaxAge`

- Cache age for files under `<publicPath>/assets/*`.
- Defaults to `1y`.

`options.publicFileMaxAge`

- Cache age for other files served from `build.assetsBuildDirectory`.
- Defaults to `1h`.

`options.logRequests`

- Logs `METHOD pathname status - duration ms` in an `onSend` hook.

`options.serverTimingHeader`

- Adds `Server-Timing: total;dur=<ms>` in an `onSend` hook.

`options.prepare(app)`

- Async hook for registering plugins, hooks, or routes before `listen()`.

`options.mode`, `options.port`, `options.host`

- Optional overrides for values normally provided by the runner.

`options.origin`

- Canonical origin used to build the Web `Request` passed to React Router.
- Useful behind proxies, TLS termination, or any deployment where the bound listen address is not
  the public origin.
- If omitted, the adapter falls back to the resolved `host` and `port`.

## Behavior

- React Router requests are passed through as standard Web `Request` objects.
- React Router `Response` bodies are streamed back through Fastify.
- Static file paths are normalized and constrained to stay inside the configured asset root.
- Missing static files fall through to the React Router request handler.

## Notes

- `createServerRunner` does not manage worker processes itself.
- The server build module is imported dynamically at runtime.
- When deploying behind a reverse proxy, set `origin` to the public URL you want route handlers to
  see.

## License

MIT
