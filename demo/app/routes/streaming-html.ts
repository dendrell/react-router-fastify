const encoder = new TextEncoder()

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    function onAbort() {
      cleanup()
      reject(new Error('Streaming HTML request aborted'))
    }

    function cleanup() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function stageMarkup(params: {
  accentClass: string
  label: string
  title: string
  description: string
  timestamp: string
}) {
  return `
    <article class="stage ${params.accentClass}">
      <div class="stage-label">${params.label}</div>
      <h2>${params.title}</h2>
      <p>${params.description}</p>
      <time>${params.timestamp}</time>
    </article>
  `
}

export async function loader({ request }: { request: Request }) {
  let startedAt = new Date().toISOString()

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Streaming HTML Demo</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #020617;
        --panel: rgba(15, 23, 42, 0.92);
        --border: rgba(148, 163, 184, 0.18);
        --text: #e2e8f0;
        --muted: #94a3b8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 28rem),
          linear-gradient(180deg, #020617 0%, #0f172a 100%);
        color: var(--text);
      }
      main {
        width: min(72rem, calc(100vw - 2rem));
        margin: 0 auto;
        padding: 3rem 0 4rem;
      }
      .hero, .stage {
        border: 1px solid var(--border);
        border-radius: 1.75rem;
        background: var(--panel);
        backdrop-filter: blur(10px);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      }
      .hero {
        padding: 2rem;
        margin-bottom: 1.25rem;
      }
      .eyebrow {
        display: inline-flex;
        border-radius: 999px;
        padding: 0.4rem 0.8rem;
        background: rgba(125, 211, 252, 0.12);
        color: #bae6fd;
        font-size: 0.75rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1, h2 {
        margin: 0;
        line-height: 1.1;
      }
      h1 {
        margin-top: 1rem;
        font-size: clamp(2.25rem, 4vw, 4rem);
      }
      p {
        color: var(--muted);
        line-height: 1.7;
      }
      .lead {
        max-width: 46rem;
        font-size: 1.02rem;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.25rem;
      }
      .meta-chip {
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(2, 6, 23, 0.5);
        padding: 0.5rem 0.85rem;
        color: #cbd5e1;
        font-size: 0.82rem;
      }
      .stages {
        display: grid;
        gap: 1rem;
      }
      .stage {
        padding: 1.35rem 1.4rem;
      }
      .stage-label {
        display: inline-flex;
        margin-bottom: 0.8rem;
        border-radius: 999px;
        padding: 0.3rem 0.7rem;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .stage p {
        margin: 0.8rem 0 1rem;
      }
      .stage time {
        color: #7dd3fc;
        font-size: 0.85rem;
      }
      .cyan .stage-label {
        background: rgba(34, 211, 238, 0.12);
        color: #a5f3fc;
      }
      .amber .stage-label {
        background: rgba(251, 191, 36, 0.14);
        color: #fde68a;
      }
      .rose .stage-label {
        background: rgba(251, 113, 133, 0.14);
        color: #fda4af;
      }
      .footer {
        margin-top: 1rem;
        color: #64748b;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">Streaming HTML</span>
        <h1>Watch the document arrive in stages.</h1>
        <p class="lead">
          This route streams a normal HTML document in multiple chunks so you can verify that the
          adapter preserves progressive delivery for non-SSE responses.
        </p>
        <div class="meta">
          <span class="meta-chip">Content-Type: text/html</span>
          <span class="meta-chip">Transport: chunked</span>
          <span class="meta-chip">Started at ${startedAt}</span>
        </div>
      </section>
      <section class="stages">
`),
          )

          await wait(400, request.signal)
          controller.enqueue(
            encoder.encode(
              stageMarkup({
                accentClass: 'cyan',
                label: 'Chunk 1',
                title: 'Initial shell rendered',
                description:
                  'The server sent the document shell first so the browser could begin parsing and painting immediately.',
                timestamp: new Date().toISOString(),
              }),
            ),
          )

          await wait(900, request.signal)
          controller.enqueue(
            encoder.encode(
              stageMarkup({
                accentClass: 'amber',
                label: 'Chunk 2',
                title: 'Follow-up content arrived',
                description:
                  'A second chunk landed later to prove that ordinary HTML streaming still flows through the adapter progressively.',
                timestamp: new Date().toISOString(),
              }),
            ),
          )

          await wait(1200, request.signal)
          controller.enqueue(
            encoder.encode(
              stageMarkup({
                accentClass: 'rose',
                label: 'Chunk 3',
                title: 'Stream completed',
                description:
                  'The final HTML fragment closes out the page after a noticeable delay, which makes buffering issues easy to spot by eye.',
                timestamp: new Date().toISOString(),
              }),
            ),
          )

          controller.enqueue(
            encoder.encode(`
      </section>
      <p class="footer">Close this tab and reopen it if you want to watch the chunks render again.</p>
    </main>
  </body>
</html>`),
          )
          controller.close()
        } catch (error) {
          if (!request.signal.aborted) {
            controller.error(error)
          }
        }
      },
      cancel() {
        // The request signal handles abort-aware delays.
      },
    }),
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  )
}
