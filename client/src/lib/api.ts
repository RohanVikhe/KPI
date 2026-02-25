export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

function getToken() {
  return localStorage.getItem("kpi_token");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorBody: any = null;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = null;
    }

    const message = errorBody?.message ?? "Request failed";
    throw new ApiError(message, response.status, errorBody?.error, errorBody?.details);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export async function apiDownload(
  path: string,
  options: RequestInit = {}
): Promise<{ blob: Blob; fileName?: string }> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    method: options.method ?? "GET",
    headers,
  });

  if (!response.ok) {
    let errorBody: any = null;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = null;
    }
    const message = errorBody?.message ?? "Download failed";
    throw new ApiError(message, response.status, errorBody?.error, errorBody?.details);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition");
  let fileName: string | undefined;

  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    const basicMatch = contentDisposition.match(/filename="?([^\";]+)"?/i);
    const raw = utf8Match?.[1] ?? basicMatch?.[1];
    if (raw) {
      try {
        fileName = decodeURIComponent(raw);
      } catch {
        fileName = raw;
      }
    }
  }

  return { blob, fileName };
}
