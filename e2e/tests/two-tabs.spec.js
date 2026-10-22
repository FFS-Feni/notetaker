import { expect, test } from "@playwright/test";
import { MAILPIT, createNote, inSeconds, localDate, newUser, unique } from "./helpers.js";

test("правка в одной вкладке сразу видна в другой — в списке и календаре", async ({ context }) => {
  await newUser(context);
  const title = unique("Купить хлеб");
  await createNote(context, { title, start_at: inSeconds(3600) });
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/notes");
  await b.goto("/calendar");
  await expect(b.getByText(title)).toBeVisible();

  await a.getByText(title).click();
  await a.getByRole("dialog").getByLabel("Заголовок").fill(`${title} и молоко`);
  await a.getByRole("button", { name: "Сохранить" }).click();

  await expect(b.getByText(`${title} и молоко`)).toBeVisible({ timeout: 5000 }); // без перезагрузки
});

test("одновременная правка: вторая вкладка видит, что версия изменилась, и ничего не теряет", async ({ context }) => {
  await newUser(context);
  const title = unique("Отчёт");
  await createNote(context, { title, start_at: inSeconds(3600) });
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const p of [a, b]) {
    await p.goto("/notes");
    await p.getByText(title).click();
  }
  await b.getByRole("dialog").getByLabel("Текст", { exact: true }).fill("мой несохранённый текст");
  await a.getByRole("dialog").getByLabel("Заголовок").fill(`${title} (правка A)`);
  await a.getByRole("button", { name: "Сохранить" }).click();

  await expect(b.getByText("Заметку изменили в другой вкладке")).toBeVisible({ timeout: 5000 });
  await expect(b.getByRole("dialog").getByLabel("Текст", { exact: true })).toHaveValue("мой несохранённый текст"); // своё не потеряно
  await b.getByRole("button", { name: "Показать их версию" }).click();
  await expect(b.getByRole("dialog").getByLabel("Заголовок")).toHaveValue(`${title} (правка A)`);
});

test("напоминание всплывает во всех вкладках, приходит одно письмо, после F5 не повторяется", async ({ context, request }) => {
  await newUser(context);
  const title = unique("Созвон");
  const [a, b] = [await context.newPage(), await context.newPage()];
  await a.goto("/upcoming");
  await b.goto("/calendar");
  await createNote(context, { title, start_at: inSeconds(600 + 4), reminders: [10] }); // сработает через ~4 с

  for (const p of [a, b]) await expect(p.getByRole("alert").filter({ hasText: title })).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => {
      const list = await (await request.get(`${MAILPIT}/api/v1/messages`)).json();
      return list.messages.filter((m) => m.Subject.includes(title)).length;
    }, { timeout: 10_000 })
    .toBe(1);

  await a.reload();
  await a.waitForTimeout(3000);
  await expect(a.getByRole("alert").filter({ hasText: title })).toHaveCount(0);
});

test("«Ближайшее»: наступило время — заметка переезжает в прошедшие без перезагрузки", async ({ context, page }) => {
  await newUser(context);
  const title = unique("Выпить воды");
  await createNote(context, { title, start_at: inSeconds(5) });
  await page.goto("/upcoming");
  await expect(page.getByTestId("column-Сегодня").getByText(title)).toBeVisible();
  await expect(page.getByTestId("column-Прошедшие").getByText(title)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("column-Сегодня").getByText(title)).toHaveCount(0);
});

test("перетаскивание в календаре переносит заметку на другой день", async ({ context, page }) => {
  await newUser(context);
  const title = unique("Врач");
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  const note = await createNote(context, { title, start_at: start.toISOString() });
  await page.goto("/calendar");
  const event = page.locator(".fc-event", { hasText: title });
  await expect(event).toBeVisible();
  const target = new Date(start.getTime() + 24 * 3600 * 1000);
  const cell = page.locator(`td.fc-day[data-date="${localDate(target)}"]`);
  const from = await event.boundingBox();
  const to = await cell.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect
    .poll(async () => (await (await context.request.get(`/api/notes/${note.id}`)).json()).start_at.slice(0, 10), { timeout: 5000 })
    .toBe(target.toISOString().slice(0, 10));
});
