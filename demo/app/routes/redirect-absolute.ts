import { redirect } from 'react-router'

export async function loader({ request }: { request: Request }) {
  let requestUrl = new URL(request.url)
  let targetUrl = new URL('/', request.url)
  targetUrl.searchParams.set('redirected', 'absolute')
  targetUrl.searchParams.set('origin', requestUrl.origin)
  targetUrl.searchParams.set('at', new Date().toISOString())

  return redirect(targetUrl.toString())
}
