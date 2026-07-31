import { env } from "@adversary/env/web";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function apiBaseUrl(): string {
  // Empty → same-origin (Vite proxy or reverse-proxy path). Absolute URL for cross-host.
  return env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = apiBaseUrl();
  if (!base) return normalized;
  return `${base}${normalized}`;
}

export function wsUrl(path: string): string {
  const httpPath = apiUrl(path);
  if (httpPath.startsWith("https://")) return `wss://${httpPath.slice("https://".length)}`;
  if (httpPath.startsWith("http://")) return `ws://${httpPath.slice("http://".length)}`;
  // Relative: derive from page location.
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${httpPath}`;
  }
  return httpPath;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, searchParams?: RequestOptions["searchParams"]): string {
  const base = apiBaseUrl();
  const url = base
    ? new URL(apiUrl(path))
    : new URL(apiUrl(path), typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return base ? url.toString() : `${url.pathname}${url.search}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, searchParams, headers, ...rest } = options;
  const init: RequestInit = {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path, searchParams), init);
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, parsed);
  }

  return parsed as T;
}
