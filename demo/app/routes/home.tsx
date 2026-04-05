import { useState } from 'react'
import { Form, useFetcher } from 'react-router'
import type { Route } from './+types/home'

type DemoExample = 'urlencoded' | 'multipart' | 'json' | 'text'

type ActionResult = {
  example: DemoExample
  contentType: string
  parsed: unknown
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

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Action Content-Type Playground' },
    {
      name: 'description',
      content: 'Demo React Router actions with form, multipart, JSON, and plain text bodies.',
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
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
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
          <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-slate-200">
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
  let jsonFetcher = useFetcher<ActionResult>()
  let multipartFetcher = useFetcher<ActionResult>()
  let [jsonName, setJsonName] = useState('Ada Lovelace')
  let [jsonRole, setJsonRole] = useState('programmer')

  let [uploadTitle, setUploadTitle] = useState('notes.txt')
  let [uploadContents, setUploadContents] = useState('Hello from an in-memory file upload.')

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

  let urlencodedResult = actionData?.example === 'urlencoded' ? actionData : null
  let textResult = actionData?.example === 'text' ? actionData : null
  let jsonResult = jsonFetcher.data ?? null
  let multipartResult = multipartFetcher.data ?? null

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="space-y-3">
          <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
            react-router-fastify demo
          </span>
          <h1 className="text-4xl font-semibold tracking-tight">Action content-type playground</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Each example posts a different request body to the same route action so you can verify
            how `react-router-fastify` handles parsing across content types.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
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

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
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

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
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

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 space-y-2">
              <h2 className="text-xl font-semibold">`text/plain`</h2>
              <p className="text-sm text-slate-400">
                Uses a native-style form with plain-text encoding so the action can inspect the raw
                body.
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
        </section>
      </div>
    </main>
  )
}
