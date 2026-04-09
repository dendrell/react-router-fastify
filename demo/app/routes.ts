import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('cookies-demo', 'routes/cookies-demo.ts'),
  route('download', 'routes/download.ts'),
  route('method-probe', 'routes/method-probe.ts'),
  route('redirect-absolute', 'routes/redirect-absolute.ts'),
  route('sse', 'routes/sse.ts'),
  route('sse/publish', 'routes/sse-publish.ts'),
  route('streaming-html', 'routes/streaming-html.ts'),
] satisfies RouteConfig
