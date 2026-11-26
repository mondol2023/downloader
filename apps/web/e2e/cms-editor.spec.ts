import { expect, test, type Page } from "@playwright/test";

const EDITOR = '[data-editor-root] .tiptap';
const button = (page: Page, name: string) => page.getByRole("toolbar", { name: "Formatting", exact: true }).getByRole("button", { name, exact: true });

/** Contextual controls (code language, image, table) live in the options group under the toolbar. */
const ctx = (page: Page, name: string) => page.getByRole("group", { name: "Selection options" }).getByRole("button", { name, exact: true });

/** Replaces the document with `hello world`, selected, ready for a toolbar action. */
async function fresh(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/dev/editor${query}`);
  await expect(page.locator(EDITOR)).toBeVisible();
  await page.locator(EDITOR).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("hello world");
  await page.keyboard.press("ControlOrMeta+A");
  return errors;
}

/** The HTML the public page will serve, read from Preview (renderHtml). */
async function preview(page: Page) {
  await button(page, "Preview").click();
  const html = await page.getByTestId("editor-preview").innerHTML();
  await button(page, "Edit").click();
  return html;
}

const marks: [string, RegExp][] = [
  ["Bold", /<strong>hello world<\/strong>/],
  ["Italic", /<em>hello world<\/em>/],
  ["Underline", /<u>hello world<\/u>/],
  ["Strikethrough", /<s>hello world<\/s>/],
  ["Inline code", /<code>hello world<\/code>/],
  ["Subscript", /<sub>hello world<\/sub>/],
  ["Superscript", /<sup>hello world<\/sup>/],
  ["Highlight colour", /<mark/],
];

for (const [name, expected] of marks.filter(([n]) => n !== "Highlight colour")) {
  test(`toolbar: ${name}`, async ({ page }) => {
    await fresh(page);
    await button(page, name).click();
    expect(await preview(page)).toMatch(expected);
  });
}

test("toolbar: heading levels, blockquote, code block, rule", async ({ page }) => {
  await fresh(page);
  for (let l = 1; l <= 6; l++) {
    await page.getByLabel("Block type").selectOption(`h${l}`);
    expect(await preview(page)).toMatch(new RegExp(`<h${l}[ >]`));
  }
  await page.getByLabel("Block type").selectOption("blockquote");
  expect(await preview(page)).toContain("<blockquote");
  await page.getByLabel("Block type").selectOption("p");
  await page.getByLabel("Block type").selectOption("codeBlock");
  await page.getByLabel("Code language").selectOption("typescript");
  expect(await preview(page)).toMatch(/<pre><code class="language-typescript">/);
  await page.getByLabel("Block type").selectOption("p");
  await button(page, "Horizontal rule").click();
  expect(await preview(page)).toContain("<hr");
});

test("toolbar: font family, size and line height", async ({ page }) => {
  await fresh(page);
  await page.getByLabel("Font family").selectOption({ label: "Georgia" });
  await page.getByLabel("Font size").selectOption("24px");
  await page.getByLabel("Line height").selectOption("1.8");
  const html = await preview(page);
  expect(html).toContain("font-size:24px");
  expect(html).toContain("font-family:Georgia, serif");
  expect(html).toContain("line-height:1.8");
});

test("toolbar: text and highlight colour, with reset", async ({ page }) => {
  await fresh(page);
  await button(page, "Text colour").click();
  await page.getByRole("button", { name: "Text colour #dc2626" }).click();
  expect(await preview(page)).toContain("color:#dc2626");
  await page.keyboard.press("ControlOrMeta+A");
  await button(page, "Text colour").click();
  await page.getByRole("button", { name: "Reset" }).click();
  expect(await preview(page)).not.toContain("color:#dc2626");

  await page.keyboard.press("ControlOrMeta+A");
  await button(page, "Highlight colour").click();
  await page.getByRole("button", { name: "Highlight colour #fde68a" }).click();
  expect(await preview(page)).toMatch(/<mark[^>]*background-color:#fde68a/);
});

test("toolbar: alignment, indent and outdent", async ({ page }) => {
  await fresh(page);
  for (const [name, css] of [["Align center", "center"], ["Align right", "right"], ["Justify", "justify"], ["Align left", "left"]] as const) {
    await button(page, name).click();
    expect(await preview(page)).toContain(`text-align:${css}`);
  }
  await button(page, "Indent").click();
  await button(page, "Indent").click();
  expect(await preview(page)).toContain("cms-indent-2");
  await button(page, "Outdent").click();
  expect(await preview(page)).toContain("cms-indent-1");
});

test("toolbar: bullet, numbered and task lists", async ({ page }) => {
  await fresh(page);
  await button(page, "Bullet list").click();
  expect(await preview(page)).toContain("<ul>");
  await button(page, "Numbered list").click();
  expect(await preview(page)).toContain("<ol>");
  await button(page, "Task list").click();
  expect(await preview(page)).toContain('data-type="taskList"');
});

test("toolbar: link add, open-in-new-tab and remove", async ({ page }) => {
  await fresh(page);
  await button(page, "Link").click();
  await page.getByLabel(/^URL/).fill("https://example.com/");
  await page.getByRole("button", { name: "Apply" }).click();
  const html = await preview(page);
  expect(html).toContain('href="https://example.com/"');
  expect(html).toContain("noopener noreferrer nofollow");
  await page.keyboard.press("ControlOrMeta+A");
  await button(page, "Link").click();
  await page.getByRole("button", { name: "Remove" }).click();
  expect(await preview(page)).not.toContain("<a ");
});

test("toolbar: image from the library, width and caption", async ({ page }) => {
  await fresh(page);
  await button(page, "Image from media library").click();
  await expect(page.getByLabel("Image alt text")).toHaveValue("Picked from library");
  await ctx(page, "Image width 50%").click();
  await page.getByLabel("Image caption").fill("A caption");
  const html = await preview(page);
  expect(html).toContain("https://cdn.example.com/cms/picked.webp");
  expect(html).toContain("cms-img-50");
  expect(html).toContain('title="A caption"');
});

test("toolbar: table insert, rows, columns, header and delete", async ({ page }) => {
  await fresh(page);
  await button(page, "Insert table").click();
  expect(await preview(page)).toMatch(/<table[\s\S]*<th/);
  await ctx(page, "Add row below").click();
  await ctx(page, "Add column after").click();
  let html = await preview(page);
  expect((html.match(/<tr/g) ?? []).length).toBe(4);
  expect((html.match(/<th/g) ?? []).length).toBe(4);
  await ctx(page, "Toggle header row").click();
  html = await preview(page);
  expect((html.match(/<th/g) ?? []).length).toBe(0);
  await ctx(page, "Delete table").click();
  expect(await preview(page)).not.toContain("<table");
});

test("toolbar: YouTube and Vimeo embeds; other hosts are refused", async ({ page }) => {
  await fresh(page);
  await button(page, "Embed video").click();
  await page.getByLabel("YouTube or Vimeo URL").fill("https://evil.example/x");
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  await expect(page.getByText("Only YouTube and Vimeo links")).toBeVisible();
  await page.getByLabel("YouTube or Vimeo URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  expect(await preview(page)).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await page.locator(EDITOR).click();
  await button(page, "Embed video").click();
  await page.getByLabel("YouTube or Vimeo URL").fill("https://vimeo.com/76979871");
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  expect(await preview(page)).toContain("https://player.vimeo.com/video/76979871");
});

test("toolbar: emoji, special characters, clear formatting, undo and redo", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("End");
  await button(page, "Emoji").click();
  await page.getByRole("button", { name: "Insert 🎉" }).click();
  await button(page, "Special characters").click();
  await page.getByRole("button", { name: "Insert ©" }).click();
  expect(await preview(page)).toContain("🎉©");

  await page.keyboard.press("ControlOrMeta+A");
  await button(page, "Bold").click();
  await button(page, "Clear formatting").click();
  expect(await preview(page)).not.toContain("<strong>");

  await button(page, "Undo").click();
  await button(page, "Redo").click();
  expect(await preview(page)).not.toContain("<strong>");
});

test("keyboard shortcuts", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.press("ControlOrMeta+I");
  await page.keyboard.press("ControlOrMeta+U");
  expect(await preview(page)).toMatch(/<strong><em><u>hello world<\/u><\/em><\/strong>|<u><em><strong>/);
  await page.keyboard.press("ControlOrMeta+Shift+8");
  expect(await preview(page)).toContain("<ul>");
  await page.keyboard.press("ControlOrMeta+Z");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  expect(await preview(page)).toContain("<ul>");
});

test("tooltips show each button's shortcut", async ({ page }) => {
  await fresh(page);
  await expect(button(page, "Bold")).toHaveAttribute("title", /Bold \((Ctrl|⌘)\+?B\)/);
  await expect(button(page, "Undo")).toHaveAttribute("title", /Undo \(/);
});

test("slash menu inserts a block", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("Delete");
  await page.keyboard.type("/heading 2");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hi");
  expect(await preview(page)).toContain("<h2");
  await page.keyboard.press("ControlOrMeta+A");
});

test("bubble menu appears on a text selection", async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole("toolbar", { name: "Selection formatting" })).toBeVisible();
  await page.getByRole("toolbar", { name: "Selection formatting" }).getByRole("button", { name: "Bold" }).click();
  expect(await preview(page)).toContain("<strong>");
});

test("pasted Word / foreign HTML is sanitised", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/html", '<p style="mso-line-height-rule:exactly;color:#16a34a">ok<img src=x onerror=alert(1)><script>alert(1)</script></p>');
    document.querySelector(".tiptap")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const html = await preview(page);
  expect(html).toContain("ok");
  expect(html).not.toMatch(/onerror|<script|mso-/);
});

test("word and character count, full-screen, HTML view", async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId("editor-count")).toHaveText("2 words · 11 chars");
  await button(page, "Full-screen").click();
  await expect(page.locator("[data-editor-root]")).toHaveClass(/fixed/);
  await button(page, "Exit full-screen").click();
  await button(page, "HTML view").click();
  await expect(page.getByTestId("editor-html")).toContainText("<p>hello world</p>");
});

test("the toolbar is keyboard navigable with a roving tabindex and labelled buttons", async ({ page }) => {
  await fresh(page);
  const bar = page.getByRole("toolbar", { name: "Formatting", exact: true });
  expect(await bar.locator('[data-tb][tabindex="0"]').count()).toBe(1);
  const unlabeled = await bar.locator("button:not([aria-label])").count();
  expect(unlabeled).toBe(0);
  await bar.locator('[data-tb][tabindex="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(bar.locator("[data-tb]:focus")).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(button(page, "Full-screen")).toBeFocused();
  expect(await bar.locator('[data-tb][tabindex="0"]').count()).toBe(1);
});

test("autosaves after the last change, and warns before unload while dirty", async ({ page }) => {
  await fresh(page, "?autosave=300");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  const before = (await page.evaluate(() => window.__saves?.length)) ?? 0;
  await page.keyboard.type(" more");
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  expect(await page.evaluate(() => window.__saves?.length)).toBe(before + 1);

  await page.keyboard.type("!");
  let prevented = false;
  await page.evaluate(() => {
    (window as unknown as { __bu: BeforeUnloadEvent }).__bu = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent((window as unknown as { __bu: Event }).__bu);
  });
  prevented = await page.evaluate(() => (window as unknown as { __bu: Event }).__bu.defaultPrevented);
  expect(prevented).toBe(true);
});

test("a 409 shows the conflict banner; Overwrite saves, Reload takes their version", async ({ page }) => {
  await fresh(page, "?autosave=200&conflict=1");
  await page.keyboard.type("x");
  const banner = page.getByRole("alert").filter({ hasText: "Someone else edited this page" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Overwrite" }).click();
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => window.__saves)).toEqual([{ version: 2, overwrite: true }]);

  await fresh(page, "?autosave=200&conflict=1");
  await page.keyboard.type("x");
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator(EDITOR)).toContainText("Their version");
});

test("the editing surface stays on the light paper palette", async ({ page }) => {
  await fresh(page);
  const bg = await page.locator("[data-editor-root]").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(251, 249, 244)");
});

test("/dev/editor renders the fixture without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/editor");
  await expect(page.locator(EDITOR)).toContainText("Editor fixture");
  await button(page, "Preview").click();
  const html = await page.getByTestId("editor-preview").innerHTML();
  for (const needle of ["<h1", "<strong>", "<table", "<blockquote", "cms-img-50", 'data-type="taskList"', "text-align:center", "language-typescript"]) {
    expect(html).toContain(needle);
  }
  expect(errors).toEqual([]);
});
