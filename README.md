# react-router-fastify

Fastify adapter for React Router server builds, designed to work with
[`node-cluster-serve`](https://github.com/itsjavi/node-cluster-serve) (optionally).

This package does not provide a Fastify dev server, it is only designed to wrap your React Router
server build, optionally serving client build assets and static files as well.

## Install

```bash
npm install react-router-fastify
# or
npx nypm add react-router-fastify
```

## What this package does

- Creates a Fastify app that serves:
  - optional client/static files from your React Router server build metadata:
    - URL base from `build.publicPath`
    - filesystem root from `build.assetsBuildDirectory`
  - `/assets/*` files with immutable cache headers
  - React Router requests through `createRequestHandler` + `@remix-run/node-fetch-server`
- Returns a runner function compatible with `node-cluster-serve`'s `runServerModule`.

## Quick start

Create a server module that default-exports a function returned by `createServerRunner`:

```ts
// ./server.ts
import { createServerRunner } from 'react-router-fastify'

const reactRouterServerBundleFile = './build/server/index.js'
export default createServerRunner(reactRouterServerBundleFile, {
  serveClientAssets: process.env.NODE_ENV !== 'production',
  assetsMaxAge: '1y',
  logRequests: true,
  serverTimingHeader: true,
  prepare: (app) => {
    // app is a Fastify instance. Use this callback to register plugins/routes before `app.listen` is called.
    app.get('/health', (req, res) => {
      res.send('OK')
    })
  },
})
```

Run it with `node-cluster-serve`:

```bash
node-cluster-serve ./server.ts --port 3000 --workerCount 4
```

Run it directly with Node (single process, no cluster runner):

```ts
// run-server.ts
import { createServerRunner } from 'react-router-fastify'

const run = createServerRunner('./build/server/index.js', {
  serveClientAssets: true,
  assetsMaxAge: '1y',
  logRequests: true,
  serverTimingHeader: true,
})

await run({
  mode: (process.env.NODE_ENV as 'development' | 'production' | 'test') ?? 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
})
```

```bash
node ./run-server.ts
```

## API

### `createServerRunner(serverBundleFile?, options)`

```ts
import type { FastifyInstance } from 'fastify'
import type { ServeFunction, ServerMode } from 'node-cluster-serve'

type CreateAppOptions = {
  serveClientAssets: boolean
  assetsMaxAge?: string
  logRequests?: boolean
  serverTimingHeader?: boolean
  bodySizeLimit?: number
}

type RunnerOptions = CreateAppOptions & {
  prepare?: (app: FastifyInstance) => Promise<void>
  mode?: ServerMode
  port?: number
  host?: string
}

declare function createServerRunner(
  serverBundleFile?: string | URL,
  options: RunnerOptions,
): ServeFunction
```

- `serverBundleFile`:
  - path or `file:` URL to your React Router server build module
  - default: `./build/server/index.js`
  - string paths are resolved from `process.cwd()`
- `options.serveClientAssets`:
  - if `true`, serves static files from `build.assetsBuildDirectory`
  - static routing is scoped under `build.publicPath`
  - requests under `<publicPath>/assets/*` use immutable cache headers
- `options.assetsMaxAge`:
  - cache max-age for `/assets/*` (default `1y`)
- `options.logRequests`:
  - when `true`, logs request method, pathname, status, and elapsed time in `onResponse` hook
  - default: `false`
- `options.serverTimingHeader`:
  - when `true`, sets `Server-Timing: total;dur=<ms>` in the `onResponse` hook
  - independent of request logging (`logRequests`)
  - default: `false`
- `options.bodySizeLimit`:
  - max buffered body size (bytes) for `application/x-www-form-urlencoded` and `multipart/form-data`
  - default: `4194304` (`4MB`)
- `options.prepare(app)`:
  - hook to register plugins/routes before calling `listen`
- `options.mode`, `options.port`, `options.host`:
  - optional overrides for `serveOptions.mode`, `serveOptions.port`, `serveOptions.host`
  - useful when you want fixed values regardless of runner-provided options

## Static files behavior

Request handling order:

1. If `serveClientAssets` is enabled and the request is under `build.publicPath`, try serving from
   `build.assetsBuildDirectory`.
2. Requests under `<publicPath>/assets/*` are served with immutable cache headers.
3. Otherwise forward request to React Router handler.

Path traversal-like input is normalized and constrained to remain inside each static root.

## Notes

- `createServerRunner` does not start cluster processes itself; use it with `node-cluster-serve`.
- The server build module is imported dynamically at runtime.
- The adapter buffers `application/x-www-form-urlencoded` and `multipart/form-data` payloads so
  React Router can consume them through the Web `Request` APIs.

## License

MIT
