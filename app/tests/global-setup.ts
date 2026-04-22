import { chromium, type FullConfig } from "@playwright/test"

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || "https://dev.umnayacrm.ru"
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.goto(`${baseURL}/login`)
  await page.fill('input[id="login"]', "owner")
  await page.fill('input[id="password"]', "demo123")
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 15000, waitUntil: "domcontentloaded" })

  // Save signed-in state
  await page.context().storageState({ path: "tests/.auth/user.json" })
  await browser.close()
}
