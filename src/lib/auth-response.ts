export function authJson(
  body: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function withNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
