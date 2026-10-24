"use client";

export const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export function operator(): string {
  if (typeof window === "undefined") return "Officer on duty";
  try { return localStorage.getItem("anvesh.operator") || "Officer on duty"; } catch { return "Officer on duty"; }
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = { "X-Operator": operator() };
  if (json) h["Content-Type"] = "application/json";
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string) => fetch(`${API}${path}`, { headers: headers(false), cache: "no-store" }).then(handle<T>),
  post: <T,>(path: string, body?: unknown) =>
    fetch(`${API}${path}`, { method: "POST", headers: headers(), body: body ? JSON.stringify(body) : undefined }).then(handle<T>),
  patch: <T,>(path: string, body: unknown) =>
    fetch(`${API}${path}`, { method: "PATCH", headers: headers(), body: JSON.stringify(body) }).then(handle<T>),
  upload: <T,>(path: string, file: File, kind: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    return fetch(`${API}${path}`, { method: "POST", headers: headers(false), body: fd }).then(handle<T>);
  },
  audioUrl: async (recId: string) => {
    const r = await fetch(`${API}/api/recordings/${recId}/audio`, { headers: headers(false) });
    if (!r.ok) throw new ApiError(r.status, "Could not load evidence audio");
    return URL.createObjectURL(await r.blob());
  },
  wsUrl: (caseId: string) => {
    const base = API.replace(/^http/, "ws");
    const q = new URLSearchParams({ operator: operator() });
    if (TOKEN) q.set("token", TOKEN);
    return `${base}/ws/cases/${caseId}/live?${q}`;
  },
};
