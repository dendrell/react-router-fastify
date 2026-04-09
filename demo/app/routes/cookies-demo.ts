const demoCookieName = 'rrh_demo_cookie'
const extraCookieNames = ['rrh_demo_cookie_a', 'rrh_demo_cookie_b']

type CookieDemoPayload = {
  action: 'read' | 'set' | 'set-many' | 'clear'
  cookieValue: string | null
  cookieHeader: string | null
  cookies: Record<string, string>
  receivedAt: string
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        let separatorIndex = part.indexOf('=')
        if (separatorIndex === -1) {
          return [part, '']
        }

        let key = part.slice(0, separatorIndex).trim()
        let value = part.slice(separatorIndex + 1).trim()

        try {
          return [key, decodeURIComponent(value)]
        } catch {
          return [key, value]
        }
      }),
  )
}

function serializeCookie(value: string | null) {
  let base = `${demoCookieName}=${value ? encodeURIComponent(value) : ''}; Path=/; HttpOnly; SameSite=Lax`
  return value ? `${base}; Max-Age=${60 * 60 * 24 * 7}` : `${base}; Max-Age=0`
}

function createPayload(request: Request, action: CookieDemoPayload['action']): CookieDemoPayload {
  let cookieHeader = request.headers.get('cookie')
  let cookies = parseCookies(cookieHeader)

  return {
    action,
    cookieValue: cookies[demoCookieName] ?? null,
    cookieHeader,
    cookies,
    receivedAt: new Date().toISOString(),
  }
}

export async function loader({ request }: { request: Request }) {
  return Response.json(createPayload(request, 'read'))
}

export async function action({ request }: { request: Request }) {
  let formData = await request.formData()
  let intent = String(formData.get('intent') ?? 'read') as CookieDemoPayload['action']

  if (intent === 'set') {
    let value = String(formData.get('value') ?? '').trim() || 'hello-from-cookie-demo'

    return Response.json(
      {
        ...createPayload(request, 'set'),
        cookieValue: value,
      } satisfies CookieDemoPayload,
      {
        headers: {
          'Set-Cookie': serializeCookie(value),
        },
      },
    )
  }

  if (intent === 'set-many') {
    let value = String(formData.get('value') ?? '').trim() || 'hello-from-cookie-demo'
    let headers = new Headers()

    headers.append('Set-Cookie', serializeCookie(value))
    headers.append(
      'Set-Cookie',
      serializeCookie(`${value}-a`).replace(demoCookieName, extraCookieNames[0]),
    )
    headers.append(
      'Set-Cookie',
      serializeCookie(`${value}-b`).replace(demoCookieName, extraCookieNames[1]),
    )

    return Response.json(
      {
        ...createPayload(request, 'set-many'),
        cookieValue: value,
      } satisfies CookieDemoPayload,
      {
        headers,
      },
    )
  }

  if (intent === 'clear') {
    let headers = new Headers()
    headers.append('Set-Cookie', serializeCookie(null))
    headers.append('Set-Cookie', serializeCookie(null).replace(demoCookieName, extraCookieNames[0]))
    headers.append('Set-Cookie', serializeCookie(null).replace(demoCookieName, extraCookieNames[1]))

    return Response.json(createPayload(request, 'clear'), {
      headers,
    })
  }

  return Response.json(createPayload(request, 'read'))
}
