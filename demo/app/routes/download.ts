function sanitizeFilename(input: string): string {
  let trimmed = input.trim() || 'react-router-hono-demo.txt'
  return trimmed.replace(/[\r\n"]/g, '').replace(/[\\/]/g, '-')
}

function createAsciiFilename(input: string): string {
  return input.replace(/[^\x20-\x7E]/g, '_')
}

function createContentDisposition(filename: string): string {
  let safeFilename = sanitizeFilename(filename)
  let asciiFilename = createAsciiFilename(safeFilename)
  let encodedFilename = encodeURIComponent(safeFilename)

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
}

export async function loader({ request }: { request: Request }) {
  let url = new URL(request.url)
  let filename = url.searchParams.get('filename') ?? 'react-router-hono-demo.txt'
  let content = url.searchParams.get('content') ?? 'Hello from react-router-hono.'

  let body = new TextEncoder().encode(content)

  return new Response(body, {
    headers: {
      'Content-Disposition': createContentDisposition(filename),
      'Content-Length': String(body.byteLength),
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Demo-Response': 'attachment',
    },
  })
}
