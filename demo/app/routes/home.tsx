import { useEffect, useState } from 'react'
import { Form, useFetcher, useLocation } from 'react-router'
import type { Route } from './+types/home'

type DemoExample = 'urlencoded' | 'multipart' | 'json' | 'text'

type ActionResult = {
  example: DemoExample
  contentType: string
  parsed: unknown
  receivedAt: string
}

type DemoNotification = {
  id: string
  message: string
  sentAt: string
}

type SsePublishResult = {
  ok: true
  notification: DemoNotification
}

type CookieDemoResult = {
  action: 'read' | 'set' | 'set-many' | 'clear'
  cookieValue: string | null
  cookieHeader: string | null
  cookies: Record<string, string>
  receivedAt: string
}

type NativeHonoResult = {
  message: string
  method: string
  path: string
  servedAt: string
}

type MethodProbeResult = {
  method: 'HEAD' | 'OPTIONS' | 'PUT'
  status: number
  headers: Record<string, string>
  receivedAt: string
}

function serializeFormData(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [
      key,
      value instanceof File
        ? {
            kind: 'file',
            name: value.name,
            size: value.size,
            type: value.type || 'application/octet-stream',
          }
        : value,
    ]),
  )
}

function parseTextPlainBody(body: string) {
  return {
    raw: body,
    lines: body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        let [key, ...rest] = line.split('=')
        return {
          key,
          value: rest.join('='),
        }
      }),
  }
}

function serializeHeaders(headers: Headers) {
  let headerNames = [
    'allow',
    'access-control-allow-methods',
    'cache-control',
    'x-demo-method',
    'x-demo-resource',
    'x-demo-timestamp',
  ]

  return Object.fromEntries(
    Array.from(headers.entries())
      .filter(([name]) => headerNames.includes(name))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Adapter Behavior Playground' },
    {
      name: 'description',
      content:
        'Demo downloads, redirects, cookies, SSE, one native Hono route, and React Router actions across multiple request body encodings.',
    },
  ]
}

export async function action({ request }: Route.ActionArgs) {
  let contentType = request.headers.get('content-type') ?? 'unknown'
  let receivedAt = new Date().toISOString()

  if (contentType.includes('application/json')) {
    return {
      example: 'json',
      contentType,
      parsed: await request.json(),
      receivedAt,
    } satisfies ActionResult
  }

  if (contentType.includes('text/plain')) {
    return {
      example: 'text',
      contentType,
      parsed: parseTextPlainBody(await request.text()),
      receivedAt,
    } satisfies ActionResult
  }

  let formData = await request.formData()
  let example = String(formData.get('example') ?? 'urlencoded') as DemoExample

  return {
    example,
    contentType,
    parsed: serializeFormData(formData),
    receivedAt,
  } satisfies ActionResult
}

function ResultPanel({ title, result }: { title: string; result?: ActionResult | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {result ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
            {result.contentType}
          </span>
        ) : null}
      </div>

      {result ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Received at {result.receivedAt}</p>
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-slate-200">
            {JSON.stringify(result.parsed, null, 2)}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Submit this example to inspect what the action sees.
        </p>
      )}
    </div>
  )
}

export default function Home({ actionData }: Route.ComponentProps) {
  let actionTarget = '?index'
  let isProdServerMode = import.meta.env.PROD
  let routerLocation = useLocation()
  let cookieReadFetcher = useFetcher<CookieDemoResult>()
  let cookieMutationFetcher = useFetcher<CookieDemoResult>()
  let jsonFetcher = useFetcher<ActionResult>()
  let multipartFetcher = useFetcher<ActionResult>()
  let ssePublishFetcher = useFetcher<SsePublishResult>()
  let [jsonName, setJsonName] = useState('Ada Lovelace')
  let [jsonRole, setJsonRole] = useState('programmer')
  let [uploadTitle, setUploadTitle] = useState('notes.txt')
  let [uploadContents, setUploadContents] = useState('Hello from an in-memory file upload.')
  let [cookieDraft, setCookieDraft] = useState('hello-from-cookie-demo')
  let [nativeHonoResult, setNativeHonoResult] = useState<NativeHonoResult | null>(null)
  let [nativeHonoState, setNativeHonoState] = useState<'idle' | 'loading'>('idle')
  let [nativeHonoError, setNativeHonoError] = useState<string | null>(null)
  let [methodProbeResult, setMethodProbeResult] = useState<MethodProbeResult | null>(null)
  let [methodProbeState, setMethodProbeState] = useState<'idle' | 'loading'>('idle')
  let [methodProbeError, setMethodProbeError] = useState<string | null>(null)
  let [sseMessage, setSseMessage] = useState('Hello from the SSE demo button.')
  let [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  let [notifications, setNotifications] = useState<DemoNotification[]>([])

  useEffect(() => {
    cookieReadFetcher.load('/cookies-demo')
  }, [])

  useEffect(() => {
    if (
      cookieMutationFetcher.state === 'idle' &&
      (cookieMutationFetcher.data?.action === 'set' ||
        cookieMutationFetcher.data?.action === 'set-many' ||
        cookieMutationFetcher.data?.action === 'clear')
    ) {
      cookieReadFetcher.load('/cookies-demo')
    }
  }, [cookieMutationFetcher.state, cookieMutationFetcher.data])

  useEffect(() => {
    let eventSource = new EventSource('/sse')

    let handleOpen = () => {
      setSseStatus('open')
    }

    let handleError = () => {
      setSseStatus('closed')
    }

    let handleNotification = (event: MessageEvent<string>) => {
      try {
        let notification = JSON.parse(event.data) as DemoNotification
        setNotifications((current) => [notification, ...current].slice(0, 8))
      } catch {
        // Ignore malformed demo events.
      }
    }

    eventSource.addEventListener('open', handleOpen)
    eventSource.addEventListener('connected', handleOpen as EventListener)
    eventSource.addEventListener('error', handleError)
    eventSource.addEventListener('notification', handleNotification as EventListener)

    return () => {
      eventSource.close()
      setSseStatus('closed')
    }
  }, [])

  function submitJsonExample() {
    jsonFetcher.submit(
      {
        example: 'json',
        person: {
          name: jsonName,
          role: jsonRole,
        },
        sentFrom: 'fetcher.submit',
      },
      {
        action: actionTarget,
        method: 'post',
        encType: 'application/json',
      },
    )
  }

  function submitMultipartExample() {
    let formData = new FormData()
    formData.set('example', 'multipart')
    formData.set('title', uploadTitle)
    formData.set(
      'attachment',
      new File([uploadContents], uploadTitle, {
        type: 'text/plain',
      }),
    )

    multipartFetcher.submit(formData, {
      action: actionTarget,
      method: 'post',
      encType: 'multipart/form-data',
    })
  }

  function publishSseMessage() {
    let formData = new FormData()
    formData.set('message', sseMessage)

    ssePublishFetcher.submit(formData, {
      action: '/sse/publish',
      method: 'post',
    })
  }

  async function loadNativeHonoRoute() {
    if (!isProdServerMode) {
      return
    }

    setNativeHonoState('loading')
    setNativeHonoResult(null)
    setNativeHonoError(null)

    try {
      let response = await fetch('/api/hello', {
        headers: {
          accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }

      setNativeHonoResult((await response.json()) as NativeHonoResult)
    } catch (error) {
      setNativeHonoError(
        error instanceof Error ? error.message : 'Unable to reach native Hono route.',
      )
    } finally {
      setNativeHonoState('idle')
    }
  }

  async function sendMethodProbe(method: MethodProbeResult['method']) {
    setMethodProbeState('loading')
    setMethodProbeResult(null)
    setMethodProbeError(null)

    try {
      let response = await fetch('/method-probe', {
        method,
      })

      setMethodProbeResult({
        method,
        status: response.status,
        headers: serializeHeaders(response.headers),
        receivedAt: new Date().toISOString(),
      })
    } catch (error) {
      setMethodProbeError(error instanceof Error ? error.message : `Unable to send ${method}.`)
    } finally {
      setMethodProbeState('idle')
    }
  }

  function submitCookieIntent(intent: CookieDemoResult['action']) {
    if (intent === 'read') {
      cookieReadFetcher.load('/cookies-demo')
      return
    }

    let formData = new FormData()
    formData.set('intent', intent)
    formData.set('value', cookieDraft)
    cookieMutationFetcher.submit(formData, {
      action: '/cookies-demo',
      method: 'post',
    })
  }

  let urlencodedResult = actionData?.example === 'urlencoded' ? actionData : null
  let textResult = actionData?.example === 'text' ? actionData : null
  let jsonResult = jsonFetcher.data ?? null
  let multipartResult = multipartFetcher.data ?? null
  let cookieResult = cookieReadFetcher.data ?? cookieMutationFetcher.data ?? null
  let searchParams = new URLSearchParams(routerLocation.search)
  let redirectedAbsolutely = searchParams.get('redirected') === 'absolute'
  let redirectedOrigin = searchParams.get('origin')
  let redirectedAt = searchParams.get('at')

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="space-y-3">
          <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
            @dendrell/react-router-hono demo
          </span>
          <h1 className="text-4xl font-semibold tracking-tight">Adapter behavior playground</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Exercise downloads, redirects, cookies, one native Hono route, event streams, and
            several request body encodings so you can verify how `@dendrell/react-router-hono`
            behaves under different transport patterns.
          </p>
        </header>

        {redirectedAbsolutely ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            Absolute redirect completed via <code>{redirectedOrigin}</code>
            {redirectedAt ? ` at ${redirectedAt}.` : '.'}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Attachment download</h2>
              <p className="max-w-3xl text-sm text-slate-400">
                Triggers a real file download from a dedicated route so you can verify raw response
                bodies plus headers like `Content-Disposition`, `Content-Length`, and a custom demo
                header.
              </p>
            </div>

            <form
              action="/download"
              className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)]"
            >
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex h-full flex-col gap-4">
                  <label className="block space-y-2">
                    <span className="text-sm text-slate-300">Filename</span>
                    <input
                      className="w-full rounded-xl border border-slate-700 bg-[#030817] px-3 py-3 outline-none"
                      defaultValue="transport-check.txt"
                      name="filename"
                    />
                  </label>

                  <div className="mt-auto pt-2">
                    <button className="inline-flex w-full items-center justify-center rounded-xl bg-sky-300 px-5 py-3 text-sm font-medium text-slate-950">
                      Download attachment
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">File contents</span>
                  <textarea
                    className="min-h-40 w-full rounded-xl border border-slate-700 bg-[#030817] px-3 py-3 outline-none"
                    defaultValue={`Downloaded at runtime from the React Router demo.\n\nUse this to validate attachment headers and non-HTML responses.`}
                    name="content"
                  />
                </label>
              </div>
            </form>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Absolute redirect</h2>
              <p className="text-sm text-slate-400">
                Uses a route that builds an absolute redirect target from <code>request.url</code>,
                then returns you here with the observed origin in the query string.
              </p>
            </div>

            <div className="space-y-4">
              <a
                className="inline-flex rounded-xl bg-violet-300 px-4 py-2 text-sm font-medium text-slate-950"
                href="/redirect-absolute"
              >
                Trigger absolute redirect
              </a>

              <p className="text-xs leading-5 text-slate-500">
                This is useful for checking that redirects use the canonical public origin instead
                of an arbitrary inbound host header.
              </p>
            </div>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Streaming HTML</h2>
              <p className="text-sm text-slate-400">
                Opens a regular HTML document that arrives in multiple chunks over time so you can
                watch non-SSE progressive rendering in the browser.
              </p>
            </div>

            <div className="space-y-4">
              <a
                className="inline-flex rounded-xl bg-cyan-200 px-4 py-2 text-sm font-medium text-slate-950"
                href="/streaming-html"
                rel="noreferrer"
                target="_blank"
              >
                Open streaming HTML demo
              </a>

              <p className="text-xs leading-5 text-slate-500">
                You should see the page shell first, then additional cards appear in stages over the
                next couple of seconds.
              </p>
            </div>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Cookies</h2>
              <p className="text-sm text-slate-400">
                Set, read, and clear an HttpOnly cookie to verify that headers and browser
                roundtrips behave as expected.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Cookie value</span>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                  onChange={(event) => setCookieDraft(event.target.value)}
                  value={cookieDraft}
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-xl bg-lime-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                  disabled={
                    cookieMutationFetcher.state !== 'idle' || cookieReadFetcher.state !== 'idle'
                  }
                  onClick={() => submitCookieIntent('set')}
                  type="button"
                >
                  Set cookie
                </button>

                <button
                  className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                  disabled={
                    cookieMutationFetcher.state !== 'idle' || cookieReadFetcher.state !== 'idle'
                  }
                  onClick={() => submitCookieIntent('set-many')}
                  type="button"
                >
                  Set many cookies
                </button>

                <button
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                  disabled={
                    cookieMutationFetcher.state !== 'idle' || cookieReadFetcher.state !== 'idle'
                  }
                  onClick={() => submitCookieIntent('read')}
                  type="button"
                >
                  Read cookie
                </button>

                <button
                  className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 disabled:opacity-60"
                  disabled={
                    cookieMutationFetcher.state !== 'idle' || cookieReadFetcher.state !== 'idle'
                  }
                  onClick={() => submitCookieIntent('clear')}
                  type="button"
                >
                  Clear cookie
                </button>
              </div>

              <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Cookie status</h3>
                  {cookieResult ? (
                    <span className="text-xs text-slate-500">{cookieResult.receivedAt}</span>
                  ) : null}
                </div>

                {cookieResult ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-slate-300">
                      Action: <span className="text-white">{cookieResult.action}</span>
                    </p>
                    <p className="text-slate-300">
                      Server sees:{' '}
                      <span className="text-white">{cookieResult.cookieValue ?? 'no cookie'}</span>
                    </p>
                    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-slate-300">
                      {JSON.stringify(cookieResult.cookies, null, 2)}
                    </pre>
                    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-slate-300">
                      {cookieResult.cookieHeader ?? 'No Cookie header received yet.'}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No cookie state loaded yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Server-Sent events</h2>
              <p className="text-sm text-slate-400">
                Opens an <code>EventSource</code> connection to a streaming route and lets you
                publish manual notifications from a separate POST request.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span
                  className={`rounded-full px-3 py-1 ${
                    sseStatus === 'open'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : sseStatus === 'connecting'
                        ? 'bg-amber-400/15 text-amber-200'
                        : 'bg-rose-500/15 text-rose-200'
                  }`}
                >
                  SSE connection: {sseStatus}
                </span>

                {ssePublishFetcher.data?.ok ? (
                  <span className="rounded-full bg-sky-400/10 px-3 py-1 text-sky-200">
                    Last publish id: {ssePublishFetcher.data.notification.id}
                  </span>
                ) : null}
              </div>

              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Notification message</span>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                  onChange={(event) => setSseMessage(event.target.value)}
                  value={sseMessage}
                />
              </label>

              <button
                className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                disabled={ssePublishFetcher.state !== 'idle'}
                onClick={publishSseMessage}
                type="button"
              >
                {ssePublishFetcher.state !== 'idle' ? 'Sending...' : 'Send SSE notification'}
              </button>

              <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Received notifications</h3>
                  <span className="text-xs text-slate-500">{notifications.length} shown</span>
                </div>

                {notifications.length > 0 ? (
                  <div className="space-y-3">
                    {notifications.map((notification) => (
                      <div
                        className="rounded-xl border border-slate-800 bg-black/30 p-3"
                        key={notification.id}
                      >
                        <p className="text-sm text-slate-100">{notification.message}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {notification.sentAt} · {notification.id}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    No notifications yet. Send one with the button above.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">Native Hono route</h2>
              <p className="text-sm text-slate-400">
                Calls the single route mounted directly in <code>demo/server.ts</code> so you can
                verify that one custom Hono handler and the React Router app can coexist.
              </p>
            </div>

            <div className="space-y-4">
              <button
                className="rounded-xl bg-teal-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!isProdServerMode || nativeHonoState !== 'idle'}
                onClick={loadNativeHonoRoute}
                type="button"
              >
                {nativeHonoState !== 'idle' ? 'Calling route...' : 'Call Hono hello route'}
              </button>

              {!isProdServerMode ? (
                <p className="text-xs leading-5 text-slate-500">
                  This route only exists in the production server because Vite dev mode does not
                  load <code>demo/server.ts</code>.
                </p>
              ) : null}

              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Native route result</h3>
                  {nativeHonoResult ? (
                    <span className="text-xs text-slate-500">{nativeHonoResult.servedAt}</span>
                  ) : null}
                </div>

                {nativeHonoError ? (
                  <p className="text-sm text-rose-300">{nativeHonoError}</p>
                ) : nativeHonoResult ? (
                  <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-slate-200">
                    {JSON.stringify(nativeHonoResult, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-400">
                    Trigger the route to inspect the one response generated outside React Router.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">HEAD / OPTIONS</h2>
              <p className="text-sm text-slate-400">
                Sends non-GET requests to a React Router resource route so you can inspect status
                codes and response headers without a response body.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-xl bg-orange-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={methodProbeState !== 'idle'}
                  onClick={() => sendMethodProbe('HEAD')}
                  type="button"
                >
                  Send HEAD
                </button>

                <button
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={methodProbeState !== 'idle'}
                  onClick={() => sendMethodProbe('OPTIONS')}
                  type="button"
                >
                  Send OPTIONS
                </button>

                <button
                  className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={methodProbeState !== 'idle'}
                  onClick={() => sendMethodProbe('PUT')}
                  type="button"
                >
                  Send PUT
                </button>
              </div>

              <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Last method probe</h3>
                  {methodProbeResult ? (
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        methodProbeResult.status >= 200 && methodProbeResult.status < 300
                          ? 'bg-sky-500/10 text-sky-200'
                          : 'bg-rose-500/15 text-rose-200'
                      }`}
                    >
                      {methodProbeResult.method} {methodProbeResult.status}
                    </span>
                  ) : null}
                </div>

                {methodProbeError ? (
                  <p className="text-sm text-rose-300">{methodProbeError}</p>
                ) : methodProbeResult ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">
                      Received at {methodProbeResult.receivedAt}
                    </p>
                    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs text-slate-200">
                      {JSON.stringify(methodProbeResult.headers, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    Send a HEAD or OPTIONS request to inspect the returned headers.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
            <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5 space-y-2">
                <h2 className="text-xl font-semibold">`application/x-www-form-urlencoded`</h2>
                <p className="text-sm text-slate-400">
                  Standard form post using React Router&apos;s default encoding.
                </p>
              </div>

              <Form action={actionTarget} method="post" className="space-y-4">
                <input type="hidden" name="example" value="urlencoded" />

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Name</span>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none ring-0"
                    defaultValue="Grace Hopper"
                    name="name"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Message</span>
                  <textarea
                    className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    defaultValue="FormData from a normal browser form."
                    name="message"
                  />
                </label>

                <button className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950">
                  Submit urlencoded form
                </button>
              </Form>
            </div>

            <ResultPanel title="Form action result" result={urlencodedResult} />
          </div>

          <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
            <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5 space-y-2">
                <h2 className="text-xl font-semibold">`multipart/form-data` with in-memory file</h2>
                <p className="text-sm text-slate-400">
                  Creates a `File` in the browser and posts it without using the local filesystem.
                </p>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Filename</span>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    onChange={(event) => setUploadTitle(event.target.value)}
                    value={uploadTitle}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">File contents</span>
                  <textarea
                    className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    onChange={(event) => setUploadContents(event.target.value)}
                    value={uploadContents}
                  />
                </label>

                <button
                  className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                  disabled={multipartFetcher.state !== 'idle'}
                  onClick={submitMultipartExample}
                  type="button"
                >
                  {multipartFetcher.state !== 'idle' ? 'Uploading...' : 'Send multipart request'}
                </button>
              </div>
            </div>

            <ResultPanel title="Multipart action result" result={multipartResult} />
          </div>

          <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
            <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5 space-y-2">
                <h2 className="text-xl font-semibold">`application/json`</h2>
                <p className="text-sm text-slate-400">
                  Uses `fetch()` to send a JSON body to the route action.
                </p>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Name</span>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    onChange={(event) => setJsonName(event.target.value)}
                    value={jsonName}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Role</span>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    onChange={(event) => setJsonRole(event.target.value)}
                    value={jsonRole}
                  />
                </label>

                <button
                  className="rounded-xl bg-fuchsia-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
                  disabled={jsonFetcher.state !== 'idle'}
                  onClick={submitJsonExample}
                  type="button"
                >
                  {jsonFetcher.state !== 'idle' ? 'Posting...' : 'Send JSON request'}
                </button>
              </div>
            </div>

            <ResultPanel title="JSON action result" result={jsonResult} />
          </div>

          <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
            <div className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5 space-y-2">
                <h2 className="text-xl font-semibold">`text/plain`</h2>
                <p className="text-sm text-slate-400">
                  Uses a native-style form with plain-text encoding so the action can inspect the
                  raw body.
                </p>
              </div>

              <Form action={actionTarget} className="space-y-4" encType="text/plain" method="post">
                <input type="hidden" name="example" value="text" />

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Subject</span>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    defaultValue="plain-text-demo"
                    name="subject"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-300">Body</span>
                  <textarea
                    className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 outline-none"
                    defaultValue="One line from a text/plain form."
                    name="body"
                  />
                </label>

                <button className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-medium text-slate-950">
                  Submit text/plain form
                </button>
              </Form>
            </div>

            <ResultPanel title="Text action result" result={textResult} />
          </div>
        </section>
      </div>
    </main>
  )
}
