export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const TZ = "Asia/Bishkek";

// Новый пользователь на каждый тест; cookie сессии — общая для всех вкладок контекста.
export async function newUser(context) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await context.request.post("/api/auth/register", { data: { email, password: "secret1", timezone: TZ } });
  if (!r.ok()) throw new Error(await r.text());
  return email;
}

export async function createNote(context, data) {
  const r = await context.request.post("/api/notes", { data });
  if (!r.ok()) throw new Error(await r.text());
  return r.json();
}

export const inSeconds = (s) => new Date(Date.now() + s * 1000).toISOString();
export const localDate = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
export const unique = (prefix) => `${prefix} ${Math.floor(Math.random() * 1e6)}`;
