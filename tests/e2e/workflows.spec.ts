import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project } from '../../src/persistence/projects';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
  await page.goto('#/lab');
  await expect(page.getByTestId('output-out-sum')).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function newProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.project-breadcrumb')).toContainText(name);
  await expect(page.locator('.nf-circuit-node')).toHaveCount(0);
}

async function addNode(page: Page, palette: string, type: string, label: string): Promise<string> {
  await page.getByTestId(`palette-${palette}`).click();
  await page.getByRole('complementary', { name: 'Inspector', exact: true }).getByLabel('Label', { exact: true }).fill(label);
  const node = page.locator(`[data-component-type="${type}"]`).last();
  const id = await node.getAttribute('data-component-id');
  expect(id).not.toBeNull();
  return id!;
}

async function selectNode(page: Page, id: string): Promise<void> {
  await page.locator(`[data-component-id="${id}"] .nf-node-title`).click();
}

async function buildAnd(page: Page): Promise<{ a: string; b: string; gate: string; output: string }> {
  const a = await addNode(page, 'switch', 'INPUT', 'A');
  const b = await addNode(page, 'switch', 'INPUT', 'B');
  const gate = await addNode(page, 'AND', 'AND', 'Conjunction');
  await page.getByLabel('Connect Conjunction.a', { exact: true }).selectOption({ label: 'A.out · 1b' });
  await page.getByLabel('Connect Conjunction.b', { exact: true }).selectOption({ label: 'B.out · 1b' });
  const output = await addNode(page, 'led', 'OUTPUT', 'Result');
  await page.getByLabel('Connect Result.in', { exact: true }).selectOption({ label: 'Conjunction.out · 1b' });
  await page.getByRole('button', { name: 'Arrange circuit', exact: true }).click();
  await expect(page.getByTestId(`output-${output}`)).toHaveAttribute('data-value', '0');
  await expect(page.locator('.nf-footer-valid')).toHaveText('Circuit is valid');
  return { a, b, gate, output };
}

async function save(page: Page): Promise<void> {
  await page.locator('.project-actions').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved locally');
}

async function exportProject(page: Page): Promise<{ text: string; project: Project }> {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.project-actions').getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.nandforge\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, 'utf8');
  return { text, project: JSON.parse(text) as Project };
}

test('builds gates, verifies AND and XOR truth tables, and opens the real four-NAND XOR circuit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const editor = await page.locator('.nf-editor-root').boundingBox();
  expect(editor).not.toBeNull();
  expect(editor!.y + editor!.height).toBeLessThanOrEqual(1001);
  await newProject(page, 'Built in the browser');
  const { output } = await buildAnd(page);
  await page.getByRole('button', { name: 'Toggle A', exact: true }).click();
  await expect(page.getByTestId(`output-${output}`)).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Toggle B', exact: true }).click();
  await expect(page.getByTestId(`output-${output}`)).toHaveAttribute('data-value', '1');
  await page.getByRole('button', { name: 'Toggle A', exact: true }).click();
  await expect(page.getByTestId(`output-${output}`)).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Truth table', exact: true }).click();
  await page.getByRole('button', { name: 'Generate truth table', exact: true }).click();
  await expect(page.locator('.nf-truth-table tbody tr')).toHaveCount(4);
  for (let row = 0; row < 4; row++) await expect(page.getByTestId(`truth-${row}-${output}`)).toHaveText(row === 3 ? '1' : '0');

  const xor = await addNode(page, 'XOR', 'XOR', 'Exclusive OR');
  await page.getByLabel('Connect Exclusive OR.a', { exact: true }).selectOption({ label: 'A.out · 1b' });
  await page.getByLabel('Connect Exclusive OR.b', { exact: true }).selectOption({ label: 'B.out · 1b' });
  await page.getByRole('button', { name: 'Arrange circuit', exact: true }).click();
  await selectNode(page, output);
  await page.getByLabel('Connect Result.in', { exact: true }).selectOption({ label: 'Exclusive OR.out · 1b' });
  await page.getByRole('button', { name: 'Generate truth table', exact: true }).click();
  for (let row = 0; row < 4; row++) await expect(page.getByTestId(`truth-${row}-${output}`)).toHaveText(row === 1 || row === 2 ? '1' : '0');
  await selectNode(page, xor);
  await page.getByRole('button', { name: 'Open internal circuit', exact: true }).click();
  const internal = page.locator('.nf-editor-layer:not([hidden])');
  await expect(internal.locator('[data-component-type="NAND"]')).toHaveCount(4);
  await expect(internal.locator('[data-component-type="XOR"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to circuit', exact: true })).toBeVisible();
  const inspectedEditor = await page.locator('.nf-editor-root').boundingBox();
  expect(inspectedEditor).not.toBeNull();
  expect(inspectedEditor!.y + inspectedEditor!.height).toBeLessThanOrEqual(1001);
});

test('deletes a selected component and restores its real connections with undo and redo', async ({ page }) => {
  await selectNode(page, 'out-sum');
  await page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Toggle a', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveCount(0);
});

test('saves and reuses a custom chip with typed ports and inspectable internal circuitry', async ({ page }) => {
  await page.getByRole('button', { name: 'Save as chip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make a reusable chip', exact: true });
  await dialog.getByLabel('Chip name', { exact: true }).fill('Portable adder');
  await dialog.getByLabel('What does this chip do?', { exact: true }).fill('Adds two bits through its saved real half-adder circuit.');
  await dialog.getByRole('button', { name: 'Create chip', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.nf-palette-item').filter({ hasText: 'Portable adder' }).click();
  const chip = await page.locator('[data-component-type="CHIP"]').getAttribute('data-component-id');
  expect(chip).not.toBeNull();
  await page.getByLabel('Connect Portable adder.a', { exact: true }).selectOption({ label: 'a.out · 1b' });
  await page.getByLabel('Connect Portable adder.b', { exact: true }).selectOption({ label: 'b.out · 1b' });
  await page.getByRole('button', { name: 'Arrange circuit', exact: true }).click();
  await selectNode(page, 'out-sum');
  await page.getByLabel('Connect sum.in', { exact: true }).selectOption({ label: 'Portable adder.sum · 1b' });
  await selectNode(page, 'out-carry');
  await page.getByLabel('Connect carry.in', { exact: true }).selectOption({ label: 'Portable adder.carry · 1b' });
  await page.getByRole('button', { name: 'Toggle a', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle b', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '0');
  await expect(page.getByTestId('output-out-carry')).toHaveAttribute('data-value', '1');
  const exported = await exportProject(page);
  expect(exported.project.chips).toHaveLength(1);
  expect(exported.project.chips[0]?.inputs.map(({ name, width }) => [name, width])).toEqual([['a', 1], ['b', 1]]);
  expect(exported.project.circuit.connections.filter(({ from }) => from.node === chip)).toHaveLength(2);
  await selectNode(page, chip!);
  await page.getByRole('button', { name: 'Open internal circuit', exact: true }).click();
  const internal = page.locator('.nf-editor-layer:not([hidden])');
  await expect(internal.locator('[data-component-id="gate"]')).toHaveAttribute('data-component-type', 'HALF_ADDER');
  await expect(internal.getByTestId('output-out-carry')).toHaveAttribute('data-value', '1');
  await expect(page.getByRole('button', { name: 'Back to circuit', exact: true })).toBeVisible();
});

test('round-trips a built circuit and assembly through JSON import, export and IndexedDB reload', async ({ page }) => {
  await newProject(page, 'Portable workspace');
  const built = await buildAnd(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'CPU Lab', exact: true }).click();
  const source = 'LDI 21\nOUT\nHLT\n';
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill(source);
  await save(page);
  const exported = await exportProject(page);
  expect(exported.project.kind).toBe('nandforge-project');
  expect(exported.project.circuit.components).toHaveLength(4);
  expect(exported.project.circuit.connections).toHaveLength(3);
  expect(exported.project.source).toBe(source);
  await newProject(page, 'A separate workspace');
  await page.locator('input[type="file"]').setInputFiles({ name: 'portable.nandforge.json', mimeType: 'application/json', buffer: Buffer.from(exported.text) });
  await expect(page.locator('.project-breadcrumb')).toContainText('Portable workspace');
  await expect(page.locator('.nf-circuit-node')).toHaveCount(4);
  await save(page);
  await page.reload();
  await expect(page.locator('.project-breadcrumb')).toContainText('Portable workspace');
  await expect(page.getByTestId(`output-${built.output}`)).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Toggle A', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle B', exact: true }).click();
  await expect(page.getByTestId(`output-${built.output}`)).toHaveAttribute('data-value', '1');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'CPU Lab', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Assembly source code' })).toHaveValue(source);
});

test('opens a compressed share link in a fresh browser context and restores a working project', async ({ page, browser }) => {
  await newProject(page, 'Shared browser circuit');
  const built = await buildAnd(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'CPU Lab', exact: true }).click();
  const source = 'LDI 37\nOUT\nHLT\n';
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill(source);
  await page.locator('.project-actions').getByRole('button', { name: 'Copy share link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share project', exact: true });
  const link = dialog.getByRole('textbox', { name: 'Share link', exact: true });
  await expect(link).toHaveAttribute('readonly', '');
  await expect(link).toHaveValue(/\/NandForge\/#share=.+/);
  const url = await link.inputValue();
  expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(/Share link copied|Select the link field/);
  await expect(link).toHaveValue(url);

  const recipient = await browser.newContext();
  try {
    const restored = await recipient.newPage();
    const recipientErrors: string[] = [];
    restored.on('pageerror', (error) => recipientErrors.push(error.message));
    await restored.goto(url);
    await expect(restored.locator('.project-breadcrumb')).toContainText('Shared browser circuit');
    await expect(restored.locator('.nf-circuit-node')).toHaveCount(4);
    await restored.getByRole('button', { name: 'Toggle A', exact: true }).click();
    await restored.getByRole('button', { name: 'Toggle B', exact: true }).click();
    await expect(restored.getByTestId(`output-${built.output}`)).toHaveAttribute('data-value', '1');
    await restored.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'CPU Lab', exact: true }).click();
    await expect(restored.getByRole('textbox', { name: 'Assembly source code' })).toHaveValue(source);
    await restored.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1000');
    await restored.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(restored.getByTestId('cpu-output')).toHaveText('37');
    await save(restored);
    await restored.reload();
    await expect(restored.locator('.project-breadcrumb')).toContainText('Shared browser circuit');
    await expect(restored.getByRole('textbox', { name: 'Assembly source code' })).toHaveValue(source);
    expect(recipientErrors).toEqual([]);
  } finally {
    await recipient.close();
  }
});

test('renames, duplicates and deletes independently persisted local projects', async ({ page }) => {
  await newProject(page, 'Original project');
  await save(page);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects', exact: true }).click();
  const card = (name: string) => page.locator('.project-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card('Original project').getByLabel('Project actions', { exact: true }).click();
  await card('Original project').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(card('Original project (copy)')).toBeVisible();
  await card('Original project (copy)').getByLabel('Project actions', { exact: true }).click();
  await card('Original project (copy)').getByRole('button', { name: 'Rename', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill('Renamed copy');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card('Renamed copy')).toBeVisible();
  if (!await card('Renamed copy').getByRole('button', { name: 'Delete', exact: true }).isVisible()) {
    await card('Renamed copy').getByLabel('Project actions', { exact: true }).click();
  }
  await card('Renamed copy').getByRole('button', { name: 'Delete', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card('Renamed copy')).toHaveCount(0);
  await expect(card('Original project')).toBeVisible();
  await page.reload();
  await expect(card('Original project')).toBeVisible();
  await expect(card('Renamed copy')).toHaveCount(0);
});

test('rejects unsafe JSON imports and keeps the current workspace usable', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: 'unsafe.json', mimeType: 'application/json', buffer: Buffer.from('{"__proto__":{"polluted":true}}') });
  await expect(page.locator('.toast')).toContainText('Unsupported document key: __proto__');
  await expect(page.locator('.project-breadcrumb')).toContainText('Half adder');
  await expect(page.locator('.nf-circuit-node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Toggle a', exact: true }).click();
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '1');
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid json') });
  await expect(page.locator('.toast')).toContainText('does not contain valid JSON');
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '1');
});

test('autosaves a recoverable circuit draft with a width error without losing other projects', async ({ page }) => {
  await save(page);
  await newProject(page, 'A draft with a width error');
  const built = await buildAnd(page);
  await selectNode(page, built.a);
  await page.getByLabel('Bus width', { exact: true }).selectOption('8');
  await expect(page.locator('.nf-footer-error')).toContainText('errors');
  await expect(page.getByTestId(`output-${built.output}`)).toHaveAttribute('data-value', 'unavailable');
  await save(page);
  await page.reload();
  await expect(page.locator('.project-breadcrumb')).toContainText('A draft with a width error');
  await expect(page.locator(`[data-component-id="${built.a}"] .nf-node-bits`)).toHaveText('8b');
  await expect(page.locator('.nf-footer-error')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Half adder', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A draft with a width error', exact: true })).toBeVisible();
});

test('steps a real register and respects pre-edge values and its enable input', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects', exact: true }).click();
  await page.locator('.template-card').filter({ has: page.getByText('Clocked register', { exact: true }) }).click();
  await expect(page.getByTestId('output-out-q')).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Step clock', exact: true }).click();
  await expect(page.getByTestId('output-out-q')).toHaveAttribute('data-value', '42');
  await page.getByRole('spinbutton', { name: 'Input value d', exact: true }).fill('99');
  await expect(page.getByTestId('output-out-q')).toHaveAttribute('data-value', '42');
  await page.getByRole('button', { name: 'Toggle en', exact: true }).click();
  await page.getByRole('button', { name: 'Step clock', exact: true }).click();
  await expect(page.getByTestId('output-out-q')).toHaveAttribute('data-value', '42');
  await page.getByRole('button', { name: 'Toggle en', exact: true }).click();
  await page.getByRole('button', { name: 'Step clock', exact: true }).click();
  await expect(page.getByTestId('output-out-q')).toHaveAttribute('data-value', '99');
});

test('connects pins directly on the canvas and earns persistent Academy progress through real verification', async ({ page }) => {
  await page.goto('#/academy/signals');
  await expect(page.getByRole('heading', { name: 'Make a connection', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify my solution', exact: true }).click();
  await expect(page.locator('.lesson-result.failure')).toBeVisible();
  await page.getByTestId('pin-input-A-out-out').dragTo(page.getByTestId('pin-output-OUT-in-in'));
  await expect(page.getByTestId('output-output-OUT')).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Verify my solution', exact: true }).click();
  await expect(page.locator('.lesson-result.success')).toContainText('Challenge complete');
  await expect(page.locator('.lesson-result.success')).toContainText('2 real behavioral tests passed');
  await page.getByRole('button', { name: 'Restore starter', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.lesson-result.success')).toHaveCount(0);
  await expect(page.getByTestId('output-output-OUT')).toHaveAttribute('data-value', 'unavailable');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Academy', exact: true }).click();
  await expect(page.locator('.lesson-card.complete').filter({ hasText: 'Make a connection' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.lesson-card.complete').filter({ hasText: 'Make a connection' })).toBeVisible();
});

test('persists Turkish language preferences while retaining a live circuit', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle a', exact: true }).click();
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Devre Lab', exact: true })).toBeVisible();
  await expect(page.getByTestId('output-out-sum')).toHaveAttribute('data-value', '1');
  await expect(page.getByRole('button', { name: 'Doğruluk tablosu', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('button', { name: 'Arayüz dili', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Dokümantasyon', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'CPU Lab', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Assembly kaynak kodu', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Bellek', exact: true })).toBeVisible();
  await expect(page.locator('.accumulator')).toContainText('AKÜMÜLATÖR');
  await expect(page.locator('.flag-registers')).toContainText('SIFIR');
  await expect(page.locator('.flag-registers')).toContainText('ELDE');
  await expect(page.locator('.operation-card')).toContainText('Komuttaki sabit baytı A yazmacına yükle.');
  await expect(page.locator('.operation-card')).toContainText('ALU seçimi · Sabit değer');
  await page.getByRole('button', { name: 'Derle ve yükle', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hız', exact: true }).selectOption('1000');
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Adım', exact: true }).click();
  await expect(page.locator('.operation-card')).toContainText('C, işaretsiz taşmayı');
  await expect(page.locator('.operation-card')).toContainText('ALU seçimi · Toplama');
  await page.getByRole('button', { name: 'Çalıştır', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('7');
  await expect(page.locator('.operation-card')).toContainText('CPU’yu durdur ve program sayacını bu komutta tut.');
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Akademi', exact: true }).click();
  await page.locator('.lesson-card').filter({ hasText: 'İlk bağlantını kur' }).click();
  await expect(page.getByRole('heading', { name: 'İlk bağlantını kur', exact: true })).toBeVisible();
  await expect(page.locator('.lesson-guide')).toContainText('Sayısal bir sinyalin iki olası değeri vardır: 0 ve 1.');
  await page.getByRole('button', { name: 'İpucu göster', exact: true }).click();
  await expect(page.locator('.lesson-hint')).toContainText('Kaynak pini bileşenin sağında, hedef pini solundadır.');
  await page.getByTestId('pin-input-A-out-out').dragTo(page.getByTestId('pin-output-OUT-in-in'));
  await page.getByRole('button', { name: 'Çözümümü doğrula', exact: true }).click();
  await expect(page.locator('.lesson-result.success')).toContainText('Görev tamamlandı');
  await expect(page.locator('.lesson-result.success')).toContainText('2 gerçek davranış testi geçti');
  await page.getByRole('button', { name: 'Arayüz dili', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Make a connection', exact: true })).toBeVisible();
  await expect(page.locator('.lesson-result.success')).toContainText('Challenge complete');
});
