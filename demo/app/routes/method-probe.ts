import type { Route } from './+types/method-probe'

function createMethodHeaders(method: string) {
  return {
    Allow: 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Demo-Method': method,
    'X-Demo-Resource': 'method-probe',
    'X-Demo-Timestamp': new Date().toISOString(),
  }
}

export function loader({ request }: Route.LoaderArgs) {
  return new Response(
    JSON.stringify({
      method: request.method,
      path: new URL(request.url).pathname,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...createMethodHeaders(request.method),
      },
    },
  )
}

export function action({ request }: Route.ActionArgs) {
  if (request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    return new Response(null, {
      status: 405,
      headers: createMethodHeaders(request.method),
    })
  }

  return new Response(null, {
    status: request.method === 'OPTIONS' ? 204 : 200,
    headers: createMethodHeaders(request.method),
  })
}
