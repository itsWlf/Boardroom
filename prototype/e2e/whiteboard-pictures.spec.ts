// Pictures of objects pasted from another whiteboard: a placeholder is filled by dropping a file on it, or by
// downloading the picture with a saved access token. The API here is a stand-in served by the test; no request
// leaves the machine.
import { test, expect, openApp, savedBoard, waitForSave, item, fit, pngBytes } from './helpers';
import type { Page } from '@playwright/test';

/** Paste a copy holding one picture (500 × 500 at the origin), wrapped the way the other app wraps its data. */
async function pastePictureCopy(page: Page) {
  const copy = {
    isProtected: false,
    boardId: 'bFictional1=',
    data: {
      objects: [
        {
          initialId: '900000000000000006',
          meta: { boardId: 'bFictional1=' },
          widgetData: {
            type: 'image',
            json: {
              _position: { offsetPx: { x: 0, y: 0 }, schema: 'canvasOffsetPx' },
              _parent: null,
              scale: { scale: 0.5 },
              crop: { x: 0, y: 0, width: 1000, height: 1000 },
              resource: { id: '777', width: 1000, height: 1000 },
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
  await waitForSave(page, b => b.items.length === 1, 'the copy is pasted');
}

test('a picture dropped on its placeholder replaces it in the same place', async ({ page }) => {
  await openApp(page);
  await pastePictureCopy(page);
  await expect(page.getByText('1 picture has a placeholder')).toBeVisible();
  const holder = (await savedBoard(page)).items[0];
  expect(holder.type).toBe('rectangle');
  expect(holder.sourceImage).toEqual({ board: 'bFictional1=', item: '900000000000000006' });
  await page.keyboard.press('Escape');
  await fit(page);
  const box = (await item(page, holder.id).boundingBox())!;
  const png = await pngBytes(page, 90, 90, '#2f9e44');
  await page.evaluate(
    async ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'photo.png', { type: 'image/png' }));
      document
        .querySelector('svg.canvas')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
        );
    },
    { b64: png.toString('base64'), x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await waitForSave(page, b => b.items[0]?.type === 'image', 'the placeholder became an image');
  const board = await savedBoard(page),
    image = board.items[0];
  // One object, same id and box; no second image was added beside it.
  expect(board.items).toHaveLength(1);
  expect(image.id).toBe(holder.id);
  expect([image.x, image.y, image.w, image.h]).toEqual([holder.x, holder.y, holder.w, holder.h]);
  expect(image.text).toBe('photo.png');
  expect(image.sourceImage).toBeUndefined();
  await expect(item(page, holder.id).locator('image')).toHaveCount(1);
});

test('with a saved access token the picture is downloaded on paste', async ({ page }) => {
  await openApp(page);
  const png = await pngBytes(page, 120, 120, '#1c7ed6');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' };
  const seen: { url: string; auth: string | undefined }[] = [];
  const api = 'https://api.whiteboard.example',
    resource = `${api}/v2/boards/bFictional1%3D/resources/images/777`,
    file = 'https://files.whiteboard.example/signed/777';
  await page.route('https://*.whiteboard.example/**', async route => {
    const request = route.request(),
      url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ url, auth: request.headers().authorization });
    if (url === `${api}/v2/boards/bFictional1%3D/images/900000000000000006`)
      return route.fulfill({
        json: { data: { title: 'Roadmap', imageUrl: `${resource}?format=preview` } },
        headers: cors,
      });
    if (url.startsWith(resource)) return route.fulfill({ json: { url: file }, headers: cors });
    if (url === file) return route.fulfill({ body: png, contentType: 'image/png', headers: cors });
    return route.fulfill({ status: 404, headers: cors });
  });

  // Save the settings through the dialog: a wrong address is refused with a message first.
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.locator('.main-menu-list [role="menuitem"]', { hasText: /^Preferences/ }).hover();
  await page.getByRole('menuitem', { name: 'Picture download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Picture download' });
  await dialog.getByLabel('API address').fill('http://api.whiteboard.example');
  await dialog.getByLabel('Access token').fill('secret-token-123');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The address must start with https://');
  await dialog.getByLabel('API address').fill(api);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Picture download is set up.')).toBeVisible();

  await pastePictureCopy(page);
  await waitForSave(page, b => b.items[0]?.type === 'image', 'the picture was downloaded into the placeholder');
  await expect(page.getByText('Downloaded 1 picture.')).toBeVisible();
  const image = (await savedBoard(page)).items[0];
  expect(image.text).toBe('Roadmap');
  expect([image.w, image.h]).toEqual([500, 500]);
  // The token went to the saved API address only, never to the file server.
  expect(seen.map(s => [new URL(s.url).host, s.auth])).toEqual([
    ['api.whiteboard.example', 'Bearer secret-token-123'],
    ['api.whiteboard.example', 'Bearer secret-token-123'],
    ['files.whiteboard.example', undefined],
  ]);

  // Removing the token turns the download off again.
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.locator('.main-menu-list [role="menuitem"]', { hasText: /^Preferences/ }).hover();
  await page.getByRole('menuitem', { name: 'Picture download…' }).click();
  await dialog.getByRole('button', { name: 'Remove token' }).click();
  expect(await page.evaluate(() => localStorage.getItem('boardroom.whiteboard-api.v1'))).toBeNull();
});
