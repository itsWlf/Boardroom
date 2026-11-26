// The Icon object: the searchable icon list (opened from the selection bar), search by other names for the same
// thing, the extra drawn icons, and icons pasted from another whiteboard.
import { test, expect, seed, waitForSave, savedBoard, item, fit } from './helpers';

test('a selected icon opens the searchable list; search words and extra icons work', async ({ page }) => {
  await seed(
    page,
    `const ic = { ...m.createItem('icon', 0, 0), id: 'ic' };
     return { version: 1, title: 'Icons', items: [ic] };`,
  );
  await fit(page);
  await item(page, 'ic').click();
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Icons' }),
    search = dialog.getByLabel('Search icons'),
    list = dialog.getByRole('listbox', { name: 'Icons' });
  await expect(list.getByRole('option').first()).toBeVisible({ timeout: 20_000 });
  // Another name for the same thing finds the bundled icon.
  await search.fill('floppy');
  await expect(list.getByRole('option', { name: 'Save', exact: true })).toBeVisible();
  await search.fill('magnifying glass');
  await expect(list.getByRole('option', { name: 'Search', exact: true })).toBeVisible();
  // An extra drawn icon is listed, drawn, and can be applied.
  await search.fill('hippo');
  const hippo = list.getByRole('option', { name: 'Hippo', exact: true });
  await expect(hippo.locator('svg path').first()).toBeAttached();
  await hippo.click();
  await dialog.locator('button.primary').click();
  await waitForSave(page, b => b.items[0].data.name === 'Hippo', 'the extra icon is stored');
  await expect(item(page, 'ic').locator('svg path').first()).toBeAttached();
});

test('an icon copied in another whiteboard is pasted as an Icon object', async ({ page }) => {
  await seed(page, `return { version: 1, title: 'Paste', items: [] };`);
  const copy = {
    isProtected: false,
    data: {
      objects: [
        {
          widgetData: {
            type: 'mockup',
            json: {
              _position: { offsetPx: { x: 0, y: 0 }, schema: 'canvasOffsetPx' },
              _parent: null,
              scale: { scale: 2 },
              size: { width: 48, height: 48 },
              mockup: { info: '{"icon":"f07c","text":""}', type: 'WIREFRAMES_ICON_2020' },
              style: '{"tc":0}',
            },
          },
        },
      ],
    },
  };
  const packed = Buffer.from(Buffer.from(JSON.stringify(copy), 'utf8').map(b => (b + 59) & 255)).toString('base64');
  const marker = ['miro', 'data', 'v1'].join('-');
  await page.evaluate(html => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }, `<span data-meta="<--(${marker})${packed}(/${marker})-->"></span>`);
  await waitForSave(page, b => b.items.length === 1, 'the icon is pasted');
  const icon = (await savedBoard(page)).items[0];
  expect(icon.type).toBe('icon');
  expect(icon.data.name).toBe('FolderOpen');
  expect([icon.w, icon.h, icon.fill]).toEqual([96, 96, '#000000']);
  await expect(page.getByText('Pasted 1 object from another whiteboard.')).toBeVisible();
  await expect(item(page, icon.id).locator('svg path').first()).toBeAttached();
});
