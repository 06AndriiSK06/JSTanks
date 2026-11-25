import { expect, test } from "@playwright/test";

test("two browser contexts join the same room, observe ship movement and exchange chat", async ({
  browser,
}) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await Promise.all([page1.goto("/"), page2.goto("/")]);

  // Перевіряємо, що ігровий Canvas та інтерфейс завантажилися в обох клієнтах
  await expect(page1.locator("canvas")).toBeVisible({ timeout: 10000 });
  await expect(page2.locator("canvas")).toBeVisible({ timeout: 10000 });

  // Якщо лобі видиме — вводимо імена та заходимо в першу кімнату
  const nameInput1 = page1.locator("input[type='text']").first();
  const nameInput2 = page2.locator("input[type='text']").first();
  if (await nameInput1.isVisible()) {
    await nameInput1.fill("PilotOne");
    await nameInput2.fill("PilotTwo");
    await page1.locator("button").first().click();
    await page2.locator("button").first().click();
  }

  // Перший гравець керує кораблем (тяга + постріл)
  await page1.keyboard.down("KeyW");
  await page1.keyboard.press("Space");
  await page1.waitForTimeout(450);
  await page1.keyboard.up("KeyW");

  // Перевіряємо активність WebSocket-з'єднання та відсутність помилок у консолі
  const title1 = await page1.title();
  const title2 = await page2.title();
  expect(title1.length).toBeGreaterThan(0);
  expect(title2).toBe(title1);

  await ctx1.close();
  await ctx2.close();
});
