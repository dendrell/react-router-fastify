import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type DemoNotification = {
  id: string
  message: string
  sentAt: string
}

const notificationLogFile = path.resolve(process.cwd(), '.local', 'demo', 'sse-events.ndjson')

async function ensureNotificationLog() {
  await mkdir(path.dirname(notificationLogFile), { recursive: true })
  await appendFile(notificationLogFile, '', 'utf8')
}

function parseNotificationLines(contents: string): DemoNotification[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DemoNotification]
      } catch {
        return []
      }
    })
}

export async function getNotificationCount(): Promise<number> {
  await ensureNotificationLog()
  let contents = await readFile(notificationLogFile, 'utf8')

  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length
}

export async function readNotificationsAfter(count: number): Promise<{
  notifications: DemoNotification[]
  nextCount: number
}> {
  await ensureNotificationLog()
  let contents = await readFile(notificationLogFile, 'utf8')
  let notifications = parseNotificationLines(contents)

  return {
    notifications: notifications.slice(count),
    nextCount: notifications.length,
  }
}

export async function publishNotification(message: string): Promise<DemoNotification> {
  let normalizedMessage = message.trim() || 'Hello from the demo SSE publisher.'
  let notification: DemoNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: normalizedMessage,
    sentAt: new Date().toISOString(),
  }

  await ensureNotificationLog()
  await appendFile(notificationLogFile, `${JSON.stringify(notification)}\n`, 'utf8')

  return notification
}
