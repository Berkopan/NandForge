import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
  await page.goto('#/cpu');
  await expect(page.getByTestId('cpu-output')).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function load(page: Page, source: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill(source);
  await page.getByRole('button', { name: 'Assemble & load', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('0');
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1000');
}

test('assembles 3 + 4, executes real steps and preserves latched output at HALT', async ({ page }) => {
  await load(page, 'LDI 3\nSTA 240\nLDI 4\nADD 240\nOUT\nHLT');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByTestId('cpu-a')).toContainText('3');
  await expect(page.getByTestId('cpu-pc')).toHaveText('0x01');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('7');
  await expect(page.getByTestId('cpu-cycle')).toHaveText('6');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  const programCounter = page.getByRole('group', { name: 'Real CPU datapath and control signals', exact: true }).getByRole('button', { name: /^PROGRAM COUNTER:/ });
  await expect(programCounter).toContainText('0x05 · HOLD');
  await programCounter.click();
  await expect(programCounter).toHaveAttribute('aria-pressed', 'true');
});

test('sets a source breakpoint, resumes, and restores previous execution state', async ({ page }) => {
  await load(page, 'LDI 3\nSTA 240\nLDI 4\nADD 240\nOUT\nHLT');
  await page.getByRole('button', { name: 'Breakpoint line 5', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Breakpoint line 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('4');
  await expect(page.getByTestId('cpu-pc')).toHaveText('0x04');
  await expect(page.getByTestId('cpu-output')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('6');
  await page.getByRole('button', { name: 'Step backward', exact: true }).click();
  await page.getByRole('button', { name: 'Step backward', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('4');
  await expect(page.getByTestId('cpu-output')).toHaveText('0');
  await expect(page.getByTestId('cpu-pc')).toHaveText('0x04');
});

test('stops after a RAM watchpoint changes and exposes actual memory content', async ({ page }) => {
  await load(page, 'LDI 23\nSTA 255\nOUT\nHLT');
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'RAM 255: 0', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'RAM 255: 23', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('cpu-output')).toHaveText('0');
  await page.getByRole('tab', { name: 'Execution log', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('RAM[255] 0 → 23');
});

test('exports waveform samples produced by real rising and falling clock edges', async ({ page }) => {
  await load(page, 'LDI 11\nOUT\nHLT');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('3');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export capture', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const capture = JSON.parse(await readFile(path!, 'utf8')) as {
    format: string; signals: { id: string; nodeId: string; pin: string }[];
    samples: { cycle: number; phase: string; values: Record<string, number> }[];
  };
  expect(capture.format).toBe('nandforge-waveform');
  const clock = capture.signals.find(({ nodeId }) => nodeId === 'clock')!;
  expect(capture.samples.map(({ phase, values }) => [phase, values[clock.id]])).toEqual([
    ['initial', 0], ['rising', 1], ['falling', 0], ['rising', 1], ['falling', 0], ['rising', 1], ['falling', 0],
  ]);
  const output = capture.signals.find(({ nodeId, pin }) => nodeId === 'io' && pin === 'output')!;
  expect(capture.samples.at(-1)?.values[output.id]).toBe(11);
});

test('editing assembly disables execution until a successful load and shows positioned errors', async ({ page }) => {
  await load(page, 'LDI 3\nOUT\nHLT');
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill('LDI 999\nOUT\nHLT');
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Assemble & load', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1:5');
  await expect(page.getByRole('alert')).toContainText('between 0 and 255');
  await expect(page.getByTestId('cpu-cycle')).toHaveText('0');
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill('LDI 5\nOUT\nHLT');
  await page.getByRole('button', { name: 'Assemble & load', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('5');
});

test('cancels scheduled clock ticks before pausing, restoring, resetting or editing a running program', async ({ page }) => {
  await load(page, 'IN\nOUT\nJMP 0');
  // Keep snapshot zero within the 256-entry history while retaining the same 30 Hz scheduling cadence.
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('100');
  await page.getByRole('spinbutton', { name: /^External input/ }).fill('42');
  const cycle = page.getByTestId('cpu-cycle');
  const waitForExecution = async () => { await expect.poll(async () => Number((await cycle.innerText()).replaceAll(',', ''))).toBeGreaterThan(0); };
  const expectStable = async (expected: string) => {
    // Let several scheduled 30 Hz UI ticks elapse: a stale interval must not mutate the restored state.
    await page.waitForTimeout(150);
    await expect(cycle).toHaveText(expected);
  };

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('42');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedCycle = await cycle.innerText();
  await expectStable(pausedCycle);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('tab', { name: /^History/ }).click();
  await page.getByRole('slider', { name: 'History', exact: true }).press('Home');
  await expect(cycle).toHaveText('0');
  await expectStable('0');
  await expect(page.getByTestId('cpu-output')).toHaveText('0');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await waitForExecution();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expectStable('0');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await waitForExecution();
  await page.getByRole('textbox', { name: 'Assembly source code' }).fill('LDI 5\nOUT\nHLT');
  const editedCycle = await cycle.innerText();
  await expectStable(editedCycle);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Assemble & load', exact: true }).click();
  await expectStable('0');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('5');
});

test('loads and executes a built-in looping example with correct final output', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Example programs' }).selectOption('summation');
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1000');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('55');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
});

test('opens actual CPU circuitry without altering the machine state', async ({ page }) => {
  await load(page, 'LDI 7\nOUT\nHLT');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-cycle')).toHaveText('3');
  await page.getByRole('button', { name: 'Inspect circuitry', exact: true }).click();
  await expect(page.locator('[data-component-id="alu"]')).toBeVisible();
  await expect(page.locator('.nf-editor-root')).toBeInViewport();
  await expect(page.getByTestId('output-OUT')).toHaveAttribute('data-value', '7');
  await page.getByRole('button', { name: 'Return to CPU', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('7');
  await expect(page.getByTestId('cpu-cycle')).toHaveText('3');
});

test('keeps CPU examples usable at a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Example programs' }).selectOption('input-output');
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1000');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cpu-output')).toHaveText('42');
  await expect(page.getByTestId('cpu-output')).toBeVisible();
});
