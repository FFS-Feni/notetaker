// Обёртка над fetch: cookie сессии уходит сама (тот же origin), ошибки — с текстом от сервера.
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      typeof detail === "string"
        ? detail
        : ((detail as { message?: string } | null)?.message ?? `Ошибка ${status}`),
    );
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; params?: Params } = {},
): Promise<T> {
  const url = new URL("/api" + path, location.origin);
  for (const [k, v] of Object.entries(opts.params ?? {}))
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    let detail = data?.detail;
    if (Array.isArray(detail))
      detail = detail.map((e: { msg: string }) => e.msg.replace(/^Value error, /, "")).join("; ");
    throw new ApiError(r.status, detail);
  }
  return data as T;
}

export type User = { id: number; email: string; timezone: string };
export type Tag = { id: number; name: string; color: string };
export type Freq = "none" | "daily" | "weekly" | "monthly";
export type Note = {
  id: string;
  title: string;
  body: string;
  start_at: string;
  tz: string;
  is_active: boolean;
  freq: Freq;
  until: string | null;
  reminders: number[];
  tags: Tag[];
  important: boolean;
  urgent: boolean;
  focus_on: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export type NotePage = { items: Note[]; total: number; next_cursor: string | null };
export type TrashItem = Note & { purge_at: string };
export type Occurrence = {
  id: string;
  note_id: string;
  original_start: string;
  start: string;
  title: string;
  body: string;
  is_active: boolean;
  freq: Freq;
  tags: Tag[];
  important: boolean;
  urgent: boolean;
  version: number;
};
export type Quadrant = { total: number; items: Note[] };
export type Matrix = { do: Quadrant; plan: Quadrant; delegate: Quadrant; drop: Quadrant };
export type Upcoming = { now: string; focus: Note[]; today: Occurrence[]; week: Occurrence[]; past: Occurrence[] };
export type AppNotification = {
  id: number;
  kind: "reminder" | "missed";
  title: string;
  body: string;
  note_id?: string | null;
  fired_at?: string;
  shown_at?: string | null;
};

export const occPath = (o: Pick<Occurrence, "note_id" | "original_start">) =>
  `/notes/${o.note_id}/occurrences/${encodeURIComponent(o.original_start)}`;
