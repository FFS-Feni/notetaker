import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Свой Chromium из системы, если есть, — чтобы не качать браузер Playwright.
const chromium = process.env.CHROMIUM ?? "/usr/bin/chromium";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    locale: "ru-RU",
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
  },
});
