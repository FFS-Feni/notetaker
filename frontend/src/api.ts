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

export type Prefs = {
  priorities: boolean;
  focus: boolean;
  email_reminders: boolean;
  popup_reminders: boolean;
  focus_limit: number;
  default_reminders: number[];
  calendar_view: "dayGridTwoWeeks" | "dayGridMonth" | "timeGridWeek" | "timeGridDay";
  week_start: 0 | 1;
  day_start: number;
  day_end: number;
  start_page: "calendar" | "notes" | "upcoming" | "tasks" | "matrix";
  theme: "auto" | "light" | "dark";
  upcoming_sections: Section[];
  color_labels: Record<string, string>;
};
export type Section = "focus" | "today" | "tomorrow" | "week" | "past";
export type User = { id: number; email: string; name: string; timezone: string; prefs: Prefs };
export type Tag = { id: number; name: string; color: string; count?: number };
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
  color: string | null;
  triaged: boolean;
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
  color: string | null;
  version: number;
};
export type Quadrant = { total: number; items: Note[] };
export type Matrix = { do: Quadrant; plan: Quadrant; delegate: Quadrant; drop: Quadrant };
export type Upcoming = { now: string; focus: Note[]; today: Occurrence[]; tomorrow: Occurrence[]; week: Occurrence[]; past: Occurrence[] };
export type NoteEvent = { id: number; at: string; action: string; changes: Record<string, unknown>; device: string; user_name: string };
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
