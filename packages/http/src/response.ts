function withDefaults(init: ResponseInit | undefined, contentType: string): ResponseInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', contentType)
  return { ...init, headers }
}

/** A JSON response. */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), withDefaults(init, 'application/json; charset=utf-8'))
}

/** A plain text response. */
export function text(body: string, init?: ResponseInit): Response {
  return new Response(body, withDefaults(init, 'text/plain; charset=utf-8'))
}

/** An HTML response. */
export function html(body: string, init?: ResponseInit): Response {
  return new Response(body, withDefaults(init, 'text/html; charset=utf-8'))
}

/** A redirect. Status defaults to 302. */
export function redirect(location: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
  return new Response(null, { status, headers: { location } })
}
