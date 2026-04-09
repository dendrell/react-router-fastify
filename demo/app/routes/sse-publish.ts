import { publishNotification } from '../lib/sse-log'

export async function action({ request }: { request: Request }) {
  let formData = await request.formData()
  let message = String(formData.get('message') ?? '')
  let notification = await publishNotification(message)

  return Response.json({
    ok: true,
    notification,
  })
}
