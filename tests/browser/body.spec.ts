import { test, expect } from "@playwright/test";
test("body views, proportions, profiles and mobile persistence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Character 1, front view, mesh material" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/body-front.png" });
  await page.getByLabel("Character name", { exact: true }).fill("Mira");
  for (const [label, value] of [
    ["Waist", "0.3"],
    ["Hips", "2.5"],
    ["Chest", "1.8"],
    ["Height", "185"],
  ]) {
    await page.getByRole("slider", { name: label, exact: true }).fill(value);
  }
  await page.getByLabel("Body material").selectOption("skin");
  await page.screenshot({ path: "test-results/body-extreme.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".body-figure")).toHaveAttribute(
    "data-view",
    "back",
  );
  await page.screenshot({ path: "test-results/body-back.png" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Waist", exact: true }),
  ).toHaveValue("1");
  await page
    .getByLabel("Character", { exact: true })
    .selectOption({ label: "Mira" });
  await expect(
    page.getByRole("slider", { name: "Waist", exact: true }),
  ).toHaveValue("0.3");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".banner[role=status]")).toContainText(
    "Saved on this device",
  );
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(
    "Mira",
  );
  await expect(
    page.getByRole("slider", { name: "Hips", exact: true }),
  ).toHaveValue("2.5");
  await expect(page.getByLabel("Body material")).toHaveValue("skin");
  await page
    .getByRole("button", { name: "Reset proportions", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Hips", exact: true }),
  ).toHaveValue("1");
  await page.locator(".panel-body").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "test-results/body-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
