import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Свой браузер из системы или кэша, если есть, — чтобы не качать браузер Playwright (медленный интернет).
const local = (path) => (path && existsSync(path) ? { executablePath: path } : {});
const chromium = local(process.env.CHROMIUM ?? "/usr/bin/chromium");
const desktop = ["two-tabs.spec.js", "priorities.spec.js"];

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:5173", locale: "ru-RU" },
  projects: [
    { name: "chromium", testMatch: desktop, use: { browserName: "chromium", launchOptions: chromium } },
    { name: "firefox", testMatch: desktop, use: { browserName: "firefox", launchOptions: local(process.env.FIREFOX) } },
    { name: "webkit", testMatch: desktop, use: { browserName: "webkit", launchOptions: local(process.env.WEBKIT) } }, // движок Safari
    { name: "phone", testMatch: ["phone.spec.js"], use: { ...devices["Pixel 7"], launchOptions: chromium } },
  ],
});
