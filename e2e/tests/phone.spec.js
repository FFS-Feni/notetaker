import { expect, test } from "@playwright/test";
import { inSeconds, newUser, unique } from "./helpers.js";

test("телефон: создать заметку, увидеть в календаре, переложить в матрице через меню, настройки", async ({ context, page }) => {
  await newUser(context);
  const title = unique("Позвонить маме");
  await page.goto("/notes");
  await page.getByRole("button", { name: "Новая заметка" }).click();
  await page.getByRole("dialog").getByLabel("Заголовок").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(title)).toBeVisible();

  // Меню — через «бургер»; календарь на телефоне открывается на виде «День».
  await page.locator(".mantine-Burger-root").click();
  await page.getByRole("link", { name: "Календарь" }).click();
  await expect(page.locator(".fc-timeGridDay-view")).toBeVisible();

  // Матрица на телефоне: перетаскивания пальцем нет — меню «Переместить в».
  await page.goto("/matrix");
  const card = page.getByTestId("quadrant-drop").getByTestId("matrix-card").filter({ hasText: title });
  await card.getByRole("button", { name: "Переместить" }).click();
  await page.getByRole("menuitem", { name: "Сделать сейчас" }).click();
  await expect(page.getByTestId("quadrant-do").getByText(title)).toBeVisible();

  // Настройки помещаются в ширину экрана, переключатель работает.
  await page.goto("/settings");
  await page.getByLabel("Фокус дня").click({ force: true });
  await expect.poll(async () => (await (await context.request.get("/api/me")).json()).prefs.focus).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1); // нет горизонтальной прокрутки
  void inSeconds;
});
