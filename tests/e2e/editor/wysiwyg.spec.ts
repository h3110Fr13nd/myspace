import { rm } from 'node:fs/promises';
import { test, expect } from '../fixtures/auth.fixture';

test.describe('WYSIWYG Editor (MDX)', () => {
  test.beforeEach(async ({ sessionPage }) => {
    // Fixed seed content is a shared visual baseline. Tests that need actual
    // persistence must create a throwaway resource instead of modifying it.
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      if (route.request().postDataJSON()?.id !== 'document:editor_test') {
        await route.continue();
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
  });
  test('slash command opens menu and inserts Callout component', async ({ sessionPage }) => {
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    const editorBody = sessionPage.locator('.novel-editor-body .tiptap');
    await expect(editorBody).toBeVisible();

    // Type slash command
    await editorBody.focus();
    await sessionPage.keyboard.press('Enter');
    await sessionPage.keyboard.type('/callout');

    // Menu should appear
    const slashMenu = sessionPage.getByText(/slash commands/i);
    await expect(slashMenu).toBeVisible();

    // Select Callout (should be the filtered option)
    await sessionPage.keyboard.press('Enter');

    // Verify callout node was inserted
    const calloutNode = sessionPage.locator('.callout-node.type-info');
    await expect(calloutNode).toBeVisible();
  });

  test('source edits survive switching to split and visual views', async ({ sessionPage }) => {
    const savedPayloads: Array<{ content: string }> = [];
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      savedPayloads.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await expect(sessionPage.locator('.novel-editor-body .tiptap')).toBeVisible();
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('Source mode preservation check');
    await sessionPage.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(sessionPage.locator('.novel-editor-body .tiptap')).toContainText('Source mode preservation check');
    await sessionPage.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(sessionPage.locator('.novel-editor-body .tiptap')).toContainText('Source mode preservation check');
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sessionPage.getByText('Saved successfully!', { exact: true })).toBeVisible();
    expect(savedPayloads.at(-1)?.content).toContain('Source mode preservation check');
  });

  test('icon picker supports selection, Escape, and focus restoration', async ({ sessionPage }) => {
    await sessionPage.route('**/api/v1/resources/save', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ success: true }),
    }));
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    const trigger = sessionPage.getByRole('button', { name: 'Change note icon', exact: true });
    await trigger.click();
    const dialog = sessionPage.getByRole('dialog', { name: 'Choose a note icon' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Rocket', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('🚀');
    await trigger.click();
    await expect(dialog.getByRole('button', { name: 'Rocket', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sessionPage.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('properties expose labelled fields and explicit tag actions', async ({ sessionPage }) => {
    await sessionPage.route('**/api/v1/resources/save', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ success: true }),
    }));
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await expect(sessionPage.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible();
    await sessionPage.getByTestId('editor-properties-toggle').click();
    await expect(sessionPage.getByRole('textbox', { name: 'Category', exact: true })).toBeVisible();
    await expect(sessionPage.getByRole('textbox', { name: 'Summary', exact: true })).toBeVisible();
    await expect(sessionPage.getByRole('checkbox', { name: 'Make this note public' })).toBeVisible();
    const add = sessionPage.getByRole('button', { name: 'Add tag', exact: true });
    await expect(add).toBeDisabled();
    await sessionPage.getByRole('textbox', { name: 'Add a tag', exact: true }).fill('ux-check');
    await add.click();
    const remove = sessionPage.getByRole('button', { name: 'Remove tag ux-check', exact: true });
    await expect(remove).toBeVisible();
    await expect(add).toBeDisabled();
    await remove.click();
    await expect(remove).toHaveCount(0);
  });

  test('mobile editor stacks split panes and follows both themes', async ({ sessionPage }, testInfo) => {
    await sessionPage.setViewportSize({ width: 390, height: 844 });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    const shell = sessionPage.locator('.editor-shell');
    await expect(shell).toBeVisible();
    await sessionPage.getByRole('button', { name: 'Split', exact: true }).click();
    const panes = sessionPage.locator('.editor-split-view');
    await expect(panes).toBeVisible();
    const titleColors: string[] = [];
    for (const theme of ['dark', 'light']) {
      await sessionPage.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
      const metrics = await shell.evaluate((element) => {
        const panes = element.querySelector('.editor-split-view')!;
        const children = [...panes.children].map(child => child.getBoundingClientRect());
        return { width: element.getBoundingClientRect().width, viewport: innerWidth,
          stacked: children[1].top >= children[0].bottom,
          text: getComputedStyle(element.querySelector('.editor-title-input')!).color };
      });
      expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.stacked).toBe(true);
      titleColors.push(metrics.text);
      await expect(sessionPage.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await testInfo.attach(`editor-${theme}-390`, { body: await sessionPage.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    expect(titleColors[0]).not.toBe(titleColors[1]);
  });

  test('public access checkbox sends the selected value when saving', async ({ sessionPage }) => {
    const saves: Array<{ is_public: boolean }> = [];
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      saves.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await sessionPage.getByTestId('editor-properties-toggle').click();
    const control = sessionPage.getByRole('checkbox', { name: 'Make this note public', exact: true });
    await control.check();
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sessionPage.getByText('Saved successfully!', { exact: true })).toBeVisible();
    expect(saves.at(-1)?.is_public).toBe(true);
    await control.uncheck();
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => saves.at(-1)?.is_public).toBe(false);
  });

  test('failed save on exit keeps unsaved source edits in the editor', async ({ sessionPage }) => {
    await sessionPage.route('**/api/v1/resources/save', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Save unavailable' }),
    }));
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await expect(sessionPage.locator('.novel-editor-body .tiptap')).toBeVisible();
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    const source = sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Keep this unsaved edit');
    let confirmations = 0;
    sessionPage.on('dialog', async (dialog) => {
      confirmations++;
      await dialog.dismiss();
    });
    await sessionPage.getByRole('button', { name: 'Exit editor', exact: true }).click();
    await expect(sessionPage.getByText('Error: Save unavailable', { exact: true })).toBeVisible();
    expect(confirmations).toBe(0);
    await expect(source).toHaveValue('Keep this unsaved edit');
    await expect(sessionPage).toHaveURL(/edit=true/);
  });

  test('manual save failure retains source text and retry succeeds', async ({ sessionPage }) => {
    let attempts = 0;
    const payloads: Array<{ content: string }> = [];
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      payloads.push(route.request().postDataJSON());
      attempts++;
      await route.fulfill({ status: attempts === 1 ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(attempts === 1 ? { error: 'Save unavailable' } : { success: true }) });
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await expect(sessionPage.locator('.novel-editor-body .tiptap')).toBeVisible();
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    const source = sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Retain this text after save failure');
    const save = sessionPage.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(sessionPage.getByText('Error: Save unavailable', { exact: true })).toBeVisible();
    await expect(source).toHaveValue('Retain this text after save failure');
    await expect(sessionPage.getByText('Saved successfully!', { exact: true })).toHaveCount(0);
    await save.click();
    await expect(sessionPage.getByText('Saved successfully!', { exact: true })).toBeVisible();
    expect(payloads.at(-1)?.content).toContain('Retain this text after save failure');
    expect(attempts).toBe(2);
  });

  test('repeated Save shortcut shares the in-flight persistence request', async ({ sessionPage }) => {
    let attempts = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      attempts += 1;
      markStarted();
      await responseGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('One serialized save');
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await started;
    await sessionPage.keyboard.press('Control+s');
    await expect.poll(() => attempts).toBe(1);
    releaseResponse();
    await expect(sessionPage.getByText('Saved successfully!', { exact: true })).toBeVisible();
    expect(attempts).toBe(1);
  });

  test('Exit waits for a save in flight and stays open if that save fails', async ({ sessionPage }) => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      markStarted();
      await responseGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Save unavailable' }) });
    });
    let confirmations = 0;
    sessionPage.on('dialog', async (dialog) => {
      confirmations += 1;
      await dialog.dismiss();
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('Keep this until save succeeds');
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await started;
    await sessionPage.getByRole('button', { name: 'Exit editor', exact: true }).click();
    await expect(sessionPage).toHaveURL(/edit=true/);
    expect(confirmations).toBe(0);
    releaseResponse();
    await expect(sessionPage.getByText('Error: Save unavailable', { exact: true })).toBeVisible();
    await expect(sessionPage).toHaveURL(/edit=true/);
    await expect(sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true }))
      .toHaveValue('Keep this until save succeeds');
  });

  test('Exit waits for an in-flight save before leaving the editor', async ({ sessionPage }) => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    let confirmations = 0;
    await sessionPage.route('**/api/v1/resources/save', async (route) => {
      markStarted();
      await responseGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    sessionPage.on('dialog', async (dialog) => {
      confirmations += 1;
      await dialog.dismiss();
    });
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await sessionPage.getByRole('button', { name: 'Source', exact: true }).click();
    await sessionPage.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('Exit after persistence');
    await sessionPage.getByRole('button', { name: 'Save', exact: true }).click();
    await started;
    await sessionPage.getByRole('button', { name: 'Exit editor', exact: true }).click();
    await expect(sessionPage).toHaveURL(/edit=true/);
    expect(confirmations).toBe(0);
    releaseResponse();
    await expect(sessionPage).not.toHaveURL(/edit=true/);
    expect(confirmations).toBe(0);
  });

  test('MDX Imports manager can add an import', async ({ sessionPage }) => {
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    await sessionPage.getByTestId('editor-properties-toggle').click();
    const importInput = sessionPage.locator('input[placeholder*="import Note from"]');
    await expect(importInput).toBeVisible();

    await importInput.fill("import MyCustomChart from '../components/MyCustomChart.tsx'");
    await importInput.press('Enter');

    // Verify it was added to the list above it
    await expect(sessionPage.locator('code', { hasText: 'import MyCustomChart' })).toBeVisible();
  });

  test('Real-time sync between two browser contexts', async ({ browser, sessionPage }) => {
    const created = await sessionPage.request.post('/api/v1/resources/create', {
      data: { title: `Collaboration test ${Date.now()}`, type: 'document' },
    });
    expect(created.status()).toBe(201);
    const resource = await created.json();
    const filePath = typeof resource.filePath === 'string' ? resource.filePath : undefined;
    const context2 = await browser.newContext();

    try {
      // Use a throwaway note: editing a fixed seeded id persists into the
      // workspace content mount and contaminates later runs.
      await context2.addCookies(await sessionPage.context().cookies());
      await sessionPage.goto(`/?doc=${encodeURIComponent(resource.id)}&edit=true`);
      const editorBody1 = sessionPage.locator('.novel-editor-body .tiptap');
      await expect(editorBody1).toBeVisible({ timeout: 15_000 });

      const page2 = await context2.newPage();
      await page2.goto(`/?doc=${encodeURIComponent(resource.id)}&edit=true`);
      const editorBody2 = page2.locator('.novel-editor-body .tiptap');
      await expect(editorBody2).toBeVisible({ timeout: 15_000 });

      const uniqueString = `Realtime_Sync_Test_${Date.now()}`;
      await editorBody1.focus();
      await sessionPage.keyboard.press('Enter');
      await sessionPage.keyboard.type(uniqueString);

      // Each browser explicitly starts the live session; this test verifies
      // collaborative editing, not the separate presence-based auto-upgrade rule.
      await sessionPage.getByRole('button', { name: 'Keep live editing on', exact: true }).click();
      await page2.getByRole('button', { name: 'Keep live editing on', exact: true }).click();
      await expect(editorBody2).toContainText(uniqueString, { timeout: 30_000 });
    } finally {
      await context2.close();
      if (filePath) await rm(filePath, { force: true });
    }
  });

  test('WYSIWYG Editor autosave and manual save update state', async ({ sessionPage }) => {
    await sessionPage.goto('/?doc=document:editor_test&edit=true');
    const editorBody = sessionPage.locator('.novel-editor-body .tiptap');
    await expect(editorBody).toBeVisible();

    // Type new text
    await editorBody.focus();
    await sessionPage.keyboard.press('Enter');
    await sessionPage.keyboard.type('Autosave verification line.');

    // Save button should be clickable and trigger successful save
    const saveBtn = sessionPage.getByRole('button', { name: 'Save', exact: true });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Should indicate saved
    await expect(sessionPage.locator('text=Saved successfully!')).toBeVisible({ timeout: 10_000 });
  });
});

