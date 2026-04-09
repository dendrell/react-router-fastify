import { getNotificationCount, readNotificationsAfter } from '../lib/sse-log'

const encoder = new TextEncoder()

function formatEvent(params: { event?: string; data?: string; id?: string }) {
  let lines: string[] = []

  if (params.id) {
    lines.push(`id: ${params.id}`)
  }

  if (params.event) {
    lines.push(`event: ${params.event}`)
  }

  if (params.data) {
    for (let line of params.data.split(/\r?\n/)) {
      lines.push(`data: ${line}`)
    }
  }

  return `${lines.join('\n')}\n\n`
}

export async function loader({ request }: { request: Request }) {
  let cancelStream: (() => void) | undefined

  return new Response(
    new ReadableStream({
      async start(controller) {
        let closed = false
        let notificationCount = await getNotificationCount()
        let pollInFlight = false
        let pollInterval: ReturnType<typeof setInterval> | undefined
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined
        let cleanupAbortListener: (() => void) | undefined

        function enqueue(chunk: string) {
          if (!closed) {
            controller.enqueue(encoder.encode(chunk))
          }
        }

        function closeStream() {
          if (closed) return
          closed = true
          if (pollInterval) clearInterval(pollInterval)
          if (heartbeatInterval) clearInterval(heartbeatInterval)
          cleanupAbortListener?.()
          try {
            controller.close()
          } catch {
            // The stream may already be closed by the runtime.
          }
        }
        cancelStream = closeStream

        enqueue(
          formatEvent({
            event: 'connected',
            data: JSON.stringify({ connectedAt: new Date().toISOString() }),
          }),
        )

        pollInterval = setInterval(async () => {
          if (closed || pollInFlight) return
          pollInFlight = true

          try {
            let result = await readNotificationsAfter(notificationCount)
            notificationCount = result.nextCount

            for (let notification of result.notifications) {
              enqueue(
                formatEvent({
                  id: notification.id,
                  event: 'notification',
                  data: JSON.stringify(notification),
                }),
              )
            }
          } finally {
            pollInFlight = false
          }
        }, 1000)

        heartbeatInterval = setInterval(() => {
          enqueue(': keepalive\n\n')
        }, 15000)

        request.signal.addEventListener('abort', closeStream, { once: true })
        cleanupAbortListener = () => {
          request.signal.removeEventListener('abort', closeStream)
        }
      },
      cancel() {
        cancelStream?.()
      },
    }),
    {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      },
    },
  )
}
