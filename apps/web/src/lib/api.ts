import type { ApiErrorBody } from "@nodedr-crm/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error body, fall through to generic message
    }
    const message = Array.isArray(body?.error.message)
      ? body.error.message.join(", ")
      : (body?.error.message ?? `Request failed with status ${res.status}`);
    throw new ApiError(res.status, body?.error.code ?? "UnknownError", message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(path: string, file: File, extraFields?: Record<string, string>) => {
    const form = new FormData();
    form.append("file", file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
    }
    return fetch(path, { method: "POST", credentials: "include", body: form }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new ApiError(res.status, body?.error.code ?? "UnknownError", String(body?.error.message ?? "Upload failed"));
      }
      return res.json() as Promise<T>;
    });
  },
};
