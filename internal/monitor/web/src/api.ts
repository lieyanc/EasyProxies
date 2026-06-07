export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    let message = response.statusText || "请求失败";
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Keep the HTTP status text when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}
