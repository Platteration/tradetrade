import { expect, test, type Locator } from "@playwright/test";

async function expectReadableControls(scope: Locator) {
  const measurements = await scope.evaluate((root) => {
    function luminance(color: string) {
      const components = color.match(/[\d.]+/g)?.map(Number);
      if (!components || components.length < 3 || (components[3] !== undefined && components[3] !== 1)) {
        throw new Error(`Expected an opaque RGB color, received ${color}`);
      }
      const linear = components.slice(0, 3).map((component) => {
        const normalized = component / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    }
    function contrast(first: string, second: string) {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    function background(element: Element | null) {
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const color = getComputedStyle(ancestor).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
      }
      return "rgb(255, 255, 255)";
    }
    const results: { description: string; ratio: number; minimum: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element || !element.checkVisibility() || element.closest('[aria-hidden="true"], option, :disabled')) continue;
      const style = getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.6667);
      results.push({ description: `Text ${JSON.stringify(text)}`, ratio: contrast(style.color, background(element)), minimum: large ? 3 : 4.5 });
    }
    for (const control of root.querySelectorAll("input:not([type=file]), select, textarea, button")) {
      if (!control.checkVisibility() || control.matches(":disabled")) continue;
      const style = getComputedStyle(control);
      const name = control.getAttribute("aria-label") || control.getAttribute("name") || control.textContent?.trim() || control.tagName;
      if (style.borderTopStyle !== "none" && style.borderTopColor !== "rgba(0, 0, 0, 0)") {
        results.push({ description: `${name} boundary`, ratio: contrast(style.borderTopColor, background(control.parentElement)), minimum: 3 });
      }
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        results.push({ description: `${name} value`, ratio: contrast(style.color, background(control)), minimum: 4.5 });
      }
      if (control instanceof HTMLInputElement && control.placeholder) {
        results.push({ description: `${name} placeholder`, ratio: contrast(getComputedStyle(control, "::placeholder").color, background(control)), minimum: 4.5 });
      }
      if (control === document.activeElement) {
        if (style.outlineStyle === "none" || parseFloat(style.outlineWidth) < 2) throw new Error(`${name} has no visible focus outline`);
        results.push({ description: `${name} focus outline`, ratio: contrast(style.outlineColor, background(control.parentElement)), minimum: 3 });
      }
    }
    return results;
  });
  expect(measurements.length).toBeGreaterThan(0);
  for (const { description, ratio, minimum } of measurements) {
    expect(ratio, `${description} must reach ${minimum}:1 contrast`).toBeGreaterThanOrEqual(minimum);
  }
}

test("portfolio controls retain readable text, boundaries and keyboard focus", async ({ page }) => {
  await page.goto("/portfolio");
  const addCard = page.getByRole("button", { name: "Add card", exact: true });
  await expect(addCard).toBeEnabled();
  await expectReadableControls(page.getByRole("main"));

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addCard).toBeFocused();
  await expectReadableControls(page.getByRole("main"));
  await addCard.hover();
  await expectReadableControls(page.getByRole("main"));

  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).focus();
  await expectReadableControls(dialog);
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  const invalidName = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(invalidName).toHaveAttribute("aria-invalid", "true");
  await expect(invalidName).toBeFocused();
  await expect(invalidName).toBeInViewport();
  await expectReadableControls(dialog);
});

test("the portfolio's main action fits before the fold on narrow screens", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/portfolio");
    const addCard = page.getByRole("button", { name: "Add card", exact: true });
    await expect(addCard).toBeEnabled();
    const bounds = await addCard.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height, "Adding a first card must not require scrolling past binder and backup tools").toBeLessThanOrEqual(844);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectReadableControls(page.getByRole("main"));
  }
});


test("graded-card alert controls have readable text, boundaries and focus", async ({ page }) => {
  await page.goto("/alerts");
  const add = page.getByRole("button", { name: "Add alert", exact: true });
  await expect(add).toBeEnabled();
  await expectReadableControls(page.getByRole("main"));
  await add.focus();
  await expectReadableControls(page.getByRole("main"));
  await add.hover();
  await expectReadableControls(page.getByRole("main"));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectReadableControls(dialog);
  await dialog.getByRole("button", { name: "Save alert", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expectReadableControls(dialog);
  await dialog.getByRole("textbox", { name: "Card name", exact: true }).fill("Contrast check card");
  await dialog.getByRole("textbox", { name: "Game", exact: true }).fill("Independent cards");
  await dialog.getByRole("textbox", { name: "Grading company", exact: true }).fill("PSA");
  await dialog.getByRole("textbox", { name: "Grade", exact: true }).fill("10");
  await dialog.getByRole("textbox", { name: "Target price", exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Save alert", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expectReadableControls(page.getByRole("main"));
  await page.getByRole("button", { name: "Record price for Contrast check card", exact: true }).focus();
  await page.keyboard.press("Enter");
  const priceDialog = page.getByRole("dialog");
  await expectReadableControls(priceDialog);
  await priceDialog.getByRole("textbox", { name: "Recorded price (USD)", exact: true }).fill("100");
  await priceDialog.getByRole("button", { name: "Save price", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(priceDialog).not.toBeVisible();
  await expectReadableControls(page.getByRole("main"));
  await page.getByRole("button", { name: "Pause Contrast check card alert", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Resume Contrast check card alert", exact: true })).toBeEnabled();
  await expectReadableControls(page.getByRole("main"));
});

test("collectible portfolio categories, estimates and editors retain readable controls", async ({ page }) => {
  await page.goto("/inventory");
  const add = page.getByRole("button", { name: "Add item", exact: true });
  await expect(add).toBeEnabled();
  await expectReadableControls(page.getByRole("main"));
  for (const kind of ["cs-skin", "book", "other"]) {
    await add.focus();
    await expectReadableControls(page.getByRole("main"));
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add an item", exact: true });
    await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption(kind);
    await dialog.getByRole("textbox", { name: "Name", exact: true }).focus();
    await expectReadableControls(dialog);
    await dialog.getByRole("button", { name: "Save item", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expectReadableControls(dialog);
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(`Contrast ${kind}`);
    if (kind === "other") await dialog.getByRole("textbox", { name: "Collectible category", exact: true }).fill("Keepsakes");
    await dialog.getByRole("textbox", { name: "Purchase cost per item", exact: true }).fill("1.00");
    await dialog.getByRole("textbox", { name: "Current estimate per item", exact: true }).fill("2.00");
    await dialog.getByRole("textbox", { name: "Sell target per item", exact: true }).fill("2.00");
    await dialog.getByRole("button", { name: "Save item", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).not.toBeVisible();
    await expectReadableControls(page.getByRole("main"));
  }
  const books = page.getByRole("button", { name: "Books", exact: true });
  await books.focus();
  await page.keyboard.press("Enter");
  await expect(books).toHaveAttribute("aria-pressed", "true");
  await expectReadableControls(page.getByRole("main"));
  await books.hover();
  await expectReadableControls(page.getByRole("main"));
});

test("the collectible portfolio fits narrow screens with its main action visible", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/inventory");
    const add = page.getByRole("button", { name: "Add item", exact: true });
    await expect(add).toBeEnabled();
    const bounds = await add.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectReadableControls(page.getByRole("main"));
  }
});

test("website sources retain readable controls in empty, error and saved-price states", async ({ page }) => {
  await page.goto("/sources");
  const add = page.getByRole("button", { name: "Add website", exact: true });
  await expect(add).toBeEnabled();
  await expectReadableControls(page.getByRole("main"));
  await add.focus();
  await expectReadableControls(page.getByRole("main"));
  await add.hover();
  await expectReadableControls(page.getByRole("main"));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "Website name", exact: true });
  await expect(name).toBeFocused();
  await expectReadableControls(dialog);
  await dialog.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
  await expectReadableControls(dialog);
  await name.fill("Readable website source");
  await dialog.getByRole("textbox", { name: "Website URL", exact: true }).fill("https://collector.example.com/item");
  await dialog.getByRole("textbox", { name: "Last observed price", exact: true }).fill("12.50");
  await dialog.getByRole("button", { name: "Save website", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expectReadableControls(page.getByRole("main"));
  const search = page.getByRole("searchbox", { name: "Search websites", exact: true });
  await search.focus();
  await expectReadableControls(page.getByRole("main"));
  await search.fill("missing source");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expectReadableControls(page.getByRole("main"));
});

test("website source actions fit narrow screens with keyboard-visible validation", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/sources");
    const add = page.getByRole("button", { name: "Add website", exact: true });
    await expect(add).toBeEnabled();
    const bounds = await add.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectReadableControls(page.getByRole("main"));
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
    await dialog.getByRole("button", { name: "Save website", exact: true }).click();
    const name = dialog.getByRole("textbox", { name: "Website name", exact: true });
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport();
    await expectReadableControls(dialog);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("account readiness content and disabled provider labels remain readable at every supported width", async ({ page }) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/account");
    await expectReadableControls(page.getByRole("main"));
    const portfolio = page.getByRole("link", { name: "Go to your portfolio", exact: true });
    await portfolio.focus();
    const outline = await portfolio.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) }));
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await expectReadableControls(page.getByRole("main"));
    for (const provider of ["Google", "Apple"]) {
      const control = page.getByRole("button", { name: `Continue with ${provider}`, exact: true });
      await expect(control).toBeDisabled();
      const ratio = await control.evaluate((element) => {
        function luminance(color: string) {
          const components = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((component) => {
            const normalized = component / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return .2126 * components[0]! + .7152 * components[1]! + .0722 * components[2]!;
        }
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return { contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), opacity: style.opacity };
      });
      expect(ratio.opacity).toBe("1");
      expect(ratio.contrast).toBeGreaterThanOrEqual(4.5);
      await control.hover();
      const bounds = await control.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
