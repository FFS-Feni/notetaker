import { expect, test } from "@playwright/test";
import { createNote, inSeconds, newUser, unique } from "./helpers.js";

test("матрица: перетаскивание в «Сделать сейчас» ставит «важно» и «срочно»; вторая вкладка видит сразу", async ({ context }) => {
  await newUser(context);
  const title = unique("Отчёт для директора");
  const note = await createNote(context, { title, start_at: inSeconds(7200) });
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/matrix");
  await b.goto("/matrix");
  await expect(a.getByTestId("quadrant-drop").getByText(title)).toBeVisible();

  await a.getByTestId("quadrant-drop").getByText(title).dragTo(a.getByTestId("quadrant-do"));

  await expect(b.getByTestId("quadrant-do").getByText(title)).toBeVisible({ timeout: 5000 });
  const saved = await (await context.request.get(`/api/notes/${note.id}`)).json();
  expect([saved.important, saved.urgent]).toEqual([true, true]);
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
  await page.getByTestId("column-Сегодня").locator("div", { hasText: first }).getByRole("button", { name: "Фокус дня" }).last().click();
  await expect(focus.getByText(first)).toBeVisible();
  await page.getByTestId("column-Сегодня").locator("div", { hasText: second }).getByRole("button", { name: "Фокус дня" }).last().click();
  await expect(page.getByText("уже 1 из 1")).toBeVisible();
});

test("настройки: выключили «Матрицу» — пункт меню пропал во всех вкладках без перезагрузки", async ({ context }) => {
  await newUser(context);
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/settings");
  await b.goto("/notes");
  await expect(b.getByRole("link", { name: "Матрица" })).toBeVisible();
  await a.getByLabel("Приоритеты и «Матрица»").click({ force: true });
  await expect(b.getByRole("link", { name: "Матрица" })).toHaveCount(0, { timeout: 5000 });
  await a.getByLabel("Приоритеты и «Матрица»").click({ force: true });
  await expect(b.getByRole("link", { name: "Матрица" })).toBeVisible({ timeout: 5000 });
});
