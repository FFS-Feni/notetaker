import { expect, test } from "@playwright/test";
import { createNote, inSeconds, newUser, unique } from "./helpers.js";

test("задачи: перетаскивание из «Неразобранных» в «Важные и срочные» ставит «важно» и «срочно»; вторая вкладка видит сразу", async ({ context }) => {
  await newUser(context);
  const title = unique("Отчёт для директора");
  const note = await createNote(context, { title, start_at: inSeconds(7200) });
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/tasks");
  await b.goto("/tasks");
  await expect(a.getByTestId("inbox").getByText(title)).toBeVisible();

  await a.getByTestId("inbox").getByText(title).dragTo(a.getByTestId("quadrant-do"));

  await expect(b.getByTestId("quadrant-do").getByText(title)).toBeVisible({ timeout: 5000 });
  const saved = await (await context.request.get(`/api/notes/${note.id}`)).json();
  expect([saved.important, saved.urgent, saved.triaged]).toEqual([true, true, true]);
  await expect(b.getByTestId("inbox").getByText(title)).toHaveCount(0);
});

test("фокус дня: ★ добавляет заметку, лимит из настроек не даёт добавить лишнюю", async ({ context, page }) => {
  await newUser(context);
  await context.request.patch("/api/settings", { data: { prefs: { focus_limit: 1 } } });
  const [first, second] = [unique("Главное"), unique("Второе")];
  await createNote(context, { title: first, start_at: inSeconds(3600) });
  await createNote(context, { title: second, start_at: inSeconds(5400) });
  await page.goto("/upcoming");
  const focus = page.getByTestId("focus");
  await expect(focus.getByText("0 из 1")).toBeVisible();
  const card = (t) => page.locator('[data-testid^="column-"] .mantine-Paper-root', { hasText: t }).first();
  await card(first).getByRole("button", { name: "Фокус дня" }).click();
  await expect(focus.getByText(first)).toBeVisible();
  await card(second).getByRole("button", { name: "Фокус дня" }).click();
  await expect(page.getByText("уже 1 из 1")).toBeVisible();
});

test("настройки: выключили доску «Задачи» — пункт меню пропал во всех вкладках без перезагрузки", async ({ context }) => {
  await newUser(context);
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/settings");
  await b.goto("/notes");
  await expect(b.getByRole("link", { name: "Задачи" })).toBeVisible();
  await a.getByLabel("Доска «Задачи»").click({ force: true });
  await expect(b.getByRole("link", { name: "Задачи" })).toHaveCount(0, { timeout: 5000 });
  await a.getByLabel("Доска «Задачи»").click({ force: true });
  await expect(b.getByRole("link", { name: "Задачи" })).toBeVisible({ timeout: 5000 });
});

test("цвет и история: выбрал цвет в списке — в истории видно, кто, откуда и что изменил", async ({ context, page }) => {
  await newUser(context);
  await context.request.patch("/api/settings", { data: { name: "Тестер" } });
  const title = unique("Договор");
  await createNote(context, { title, start_at: inSeconds(7200) });
  await page.goto("/notes");
  const card = page.locator(".mantine-Paper-root", { hasText: title }).first();
  await card.getByRole("button", { name: "Цвет задачи" }).click();
  await page.locator(".mantine-Popover-dropdown").getByRole("button", { name: "Работа" }).click();
  await expect.poll(async () => (await (await context.request.get("/api/notes?q=" + encodeURIComponent(title))).json()).items[0].color).toBe("blue");

  await card.getByText(title).click();
  await page.getByRole("dialog").getByText("История изменений").click();
  const history = page.getByRole("dialog");
  await expect(history.getByText("Тестер").first()).toBeVisible();
  await expect(history.getByText(/Цвет: .*Работа/)).toBeVisible();
  await expect(history.getByText(/Chrome|Firefox|Safari/).first()).toBeVisible();
});

test("быстрый ввод одной строкой: дата, время, тег и приоритет распознаются и видны до создания", async ({ context, page }) => {
  await newUser(context);
  await page.goto("/upcoming");
  const input = page.getByRole("textbox", { name: "Быстрая заметка" }).first();
  await input.fill("завтра в 9 позвонить маме #семья !важно");
  await expect(page.getByText("Позвонить маме").first()).toBeVisible();
  await expect(page.locator(".mantine-Popover-dropdown").getByText("#семья (новый)")).toBeVisible();
  await input.press("Enter");
  await expect(page.getByText("Заметка создана")).toBeVisible();
  const notes = (await (await context.request.get("/api/notes?q=маме")).json()).items;
  expect(notes.map((n) => [n.title, n.important, n.tags[0].name])).toEqual([["Позвонить маме", true, "семья"]]);
});

test("«напомнить позже» из уведомления: закрывается во всех вкладках, создаётся новое напоминание", async ({ context }) => {
  await newUser(context);
  const title = unique("Звонок клиенту");
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/upcoming");
  await b.goto("/notes");
  const note = await createNote(context, { title, start_at: inSeconds(600 + 3), reminders: [10] });
  for (const p of [a, b]) await expect(p.getByRole("alert").filter({ hasText: title })).toBeVisible({ timeout: 15_000 });
  await a.getByRole("alert").filter({ hasText: title }).getByRole("button", { name: "через 10 мин" }).click();
  for (const p of [a, b]) await expect(p.getByRole("alert").filter({ hasText: title })).toHaveCount(0, { timeout: 5000 });
  const history = await (await context.request.get(`/api/notes/${note.id}`)).json();
  expect(history.is_active).toBe(true);
});
