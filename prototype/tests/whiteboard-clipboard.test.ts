// Paste from another whiteboard app's clipboard. The fixture is written by hand in the shape seen in a real copy
// (2026-11-26); ids, names and addresses are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/model.ts';
import { pastePayload } from '../src/clipboard.ts';
import {
  decodeWhiteboardClipboard,
  fillPicturePlaceholder,
  PICTURE_HINT,
  picturePlaceholderAt,
  PROTECTED_MESSAGE,
  readWhiteboardClipboard,
  whiteboardPasteNote,
} from '../src/whiteboard-clipboard.ts';

/** Wrap JSON the way the other app does: UTF-8 bytes raised by 59, base64, inside a marker in a span. */
function clipboardHtml(json: unknown, marker = 'miro-data-v1'): string {
  const bytes = new TextEncoder().encode(JSON.stringify(json)),
    packed = String.fromCharCode(...bytes.map(b => (b + 59) & 255));
  return `<html><body><!--StartFragment--><span data-meta="<--(${marker})${btoa(packed)}(/${marker})-->"></span><div>Plan</div><!--EndFragment--></body></html>`;
}
const placed = (x: number, y: number, parent?: number) => ({
  _position: {
    offsetPx: { x, y },
    schema: parent === undefined ? 'canvasOffsetPx' : 'parentOffsetPx',
    ...(parent === undefined ? {} : { containerType: 'FRAME' }),
  },
  _parent: parent === undefined ? null : { index: parent },
  rotation: { rotation: 0 },
});
const widget = (type: string, json: Record<string, unknown>, k: number) => ({
  widgetData: { json, type },
  type: 14,
  id: k,
  initialId: `90000000000000000${k}`,
  meta: { boardId: 'bFictional1=', orgId: '1000000000000000001', widgetToken: k + 1 },
});
const copyOf = (objects: [string, Record<string, unknown>][], extra: Record<string, unknown> = {}) => ({
  isProtected: false,
  boardId: 'bFictional1=',
  data: { objects: objects.map(([type, json], k) => widget(type, json, k)), meta: {} },
  version: 2,
  host: 'whiteboard.example',
  copierType: 'COPY',
  ...extra,
});

const FIXTURE = copyOf([
  // 0: a yellow sticky note, 200 × 230 at scale 1.5.
  [
    'sticker',
    {
      ...placed(-400, -300),
      scale: { scale: 1.5 },
      size: { width: 200, height: 230 },
      text: '<p>Ship <strong>it</strong></p>',
      style: JSON.stringify({ ta: 'c', tav: 'm', sbc: 0xfff79e }),
    },
  ],
  // 1: a rectangle with a red dashed border and no fill.
  [
    'shape',
    {
      ...placed(0, 0),
      scale: { scale: 1 },
      size: { width: 300, height: 100 },
      text: '<p>Review</p>',
      shape: '3',
      style: JSON.stringify({ st: 3, bc: -1, bo: 1, brc: 0xff0000, brw: 4, bro: 1, brs: 0, tc: 0x1a1a1a, fs: 20 }),
    },
  ],
  // 2: a frame, 800 × 600, centred at (1000, 0).
  ['frame', { ...placed(1000, 0), scale: { scale: 1 }, size: { width: 800, height: 600 }, text: 'Sprint 12' }],
  // 3: a pen stroke inside the frame, placed from the frame's top-left corner.
  [
    'paint',
    {
      ...placed(400, 300, 2),
      scale: { scale: 2 },
      points: [
        { x: 0, y: 10 },
        { x: 50, y: 0 },
        { x: 100, y: 40 },
      ],
      style: JSON.stringify({ lc: 0x0000ff, t: 3 }),
    },
  ],
  // 4: a text box: base size 64 × 20 at scale 3.
  [
    'text',
    {
      ...placed(0, 300),
      scale: { scale: 3 },
      size: { width: 64, height: 20 },
      text: '<p>Heading</p>',
      style: JSON.stringify({ st: 14, bc: -1, ta: 'l', tc: 0x1a1a1a }),
    },
  ],
  // 5: an elbow connector from the sticky note (0) to the rectangle (1).
  [
    'line',
    {
      points: [],
      primary: { positionType: 0, widgetIndex: 0 },
      secondary: { positionType: 0, widgetIndex: 1 },
      _position: null,
      _parent: null,
      style: JSON.stringify({ lc: 0x333333, ls: 2, t: 2, lt: 1, a_start: 0, a_end: 9 }),
      line: { captions: [] },
    },
  ],
  // 6: a picture: the file itself is not on the clipboard.
  [
    'image',
    {
      ...placed(0, 700),
      scale: { scale: 0.5 },
      crop: { x: 0, y: 0, width: 1600, height: 900 },
      resource: { name: 'diagram.png', id: '777', width: 1600, height: 900 },
    },
  ],
  // 7: a link preview.
  [
    'embed',
    {
      ...placed(-900, 0),
      scale: { scale: 1 },
      size: { width: 320, height: 480 },
      custom_data: { url: 'https://docs.example/plan', title: 'Plan', description: 'Quarter plan' },
    },
  ],
  // 8: a connector with a loose end, and 9: a kind this reader has never seen.
  ['line', { primary: { positionType: 0, widgetIndex: 0 }, secondary: { positionType: 1 }, style: '{}' }],
  ['kanban', { ...placed(2000, 0), scale: { scale: 1 }, size: { width: 500, height: 400 } }],
]);

test('the data block decodes; other HTML and damaged blocks do not', () => {
  const html = clipboardHtml(FIXTURE);
  assert.equal((decodeWhiteboardClipboard(html) as any).data.objects.length, 10);
  assert.equal(decodeWhiteboardClipboard('<div>plain</div>'), null);
  assert.equal(decodeWhiteboardClipboard(clipboardHtml(FIXTURE, 'other-data-v1')), null);
  assert.equal(decodeWhiteboardClipboard(html.replace(/\)[A-Za-z0-9+/=]{20}/, ')AAAAAAAAAAAAAAAAAAAA')), null);
  assert.equal(decodeWhiteboardClipboard(clipboardHtml({ data: { objects: 'no' } })), null);
  assert.equal(readWhiteboardClipboard('<div>plain</div>'), null);
});

test('text outside ASCII survives the byte offset (assuming UTF-8 bytes; not yet seen in a real copy)', () => {
  const copy = copyOf([
    ['sticker', { ...placed(0, 0), scale: { scale: 1 }, size: { width: 200, height: 230 }, text: '<p>Café ✓</p>' }],
  ]);
  assert.equal(readWhiteboardClipboard(clipboardHtml(copy))!.payload.items[0].text, 'Café ✓');
});

test('copied objects become Boardroom objects in the same places', () => {
  const paste = readWhiteboardClipboard(clipboardHtml(FIXTURE))!;
  const items = paste.payload.items,
    one = (type: string) => items.find(i => i.type === type)!;
  // Everything loads as a board.
  parseBoard({ version: 1, title: 't', items });

  // Sticky note: size is base × scale, the position is its centre, the colour is the nearest sticky colour.
  const note = one('note');
  assert.deepEqual([note.x, note.y, note.w, note.h], [-550, -472, 300, 345]);
  assert.equal(note.fill, '#fff49b');
  assert.equal(note.text, 'Ship it');
  assert.equal(note.spans?.length, 1);

  // Rectangle: border colour, width and dash; text size.
  const rect = items.find(i => i.type === 'rectangle' && i.text === 'Review')!;
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [-150, -50, 300, 100]);
  assert.deepEqual(rect.style, { borderColor: '#ff0000', borderWidth: 4, borderStyle: 'dashed' });
  assert.equal(rect.format?.fontSize, 20);

  // Frame, and the pen stroke placed from the frame's top-left corner: (1000-400+400, 0-300+300) = (1000, 0).
  const frame = one('frame');
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h, frame.text], [600, -300, 800, 600, 'Sprint 12']);
  const pen = one('pen');
  assert.deepEqual([pen.x, pen.y, pen.w, pen.h], [900, -40, 200, 80]);
  assert.deepEqual(pen.points, [
    { x: 0, y: 20 },
    { x: 100, y: 0 },
    { x: 200, y: 80 },
  ]);
  assert.equal(pen.fill, '#0000ff');
  assert.deepEqual(pen.data, { style: 'pen', width: 6 });

  // Text: the font grows with the scale (14 × 3).
  const text = one('text');
  assert.equal(text.text, 'Heading');
  assert.equal(text.format?.fontSize, 42);
  // Wider than the copied 192 so the words do not wrap in this app's font, and the height follows the text.
  assert.equal(text.w, 237);
  assert.equal(text.format?.autoHeight, true);

  // Connector: attached to the pasted note and rectangle, drawn as an elbow with an arrow at the end.
  const line = one('arrow');
  assert.equal(line.from, note.id);
  assert.equal(line.to, rect.id);
  assert.deepEqual(line.connector, { path: 'elbow', startHead: 'none', endHead: 'arrow', width: 2 });
  assert.equal(line.fill, '#333333');

  // Link preview becomes a bookmark.
  assert.deepEqual(one('bookmark').data, {
    url: 'https://docs.example/plan',
    title: 'Plan',
    description: 'Quarter plan',
    layout: 'none',
  });

  // The picture and the unknown kind keep their place as placeholders; the loose connector is counted.
  // The picture's placeholder remembers which picture it stands for (no crop: the whole file was shown).
  const image = items.find(i => i.text === PICTURE_HINT)!;
  assert.deepEqual([image.w, image.h], [800, 450]);
  assert.deepEqual(image.sourceImage, { board: 'bFictional1=', item: '900000000000000006' });
  assert.ok(items.some(i => i.text === 'Kanban object (not copied)'));
  assert.equal(paste.report.danglingConnectors, 1);
  assert.equal(paste.strokes, 1);
  assert.equal(items.length, 9);
  assert.equal(
    whiteboardPasteNote(paste),
    'Pasted 9 objects from another whiteboard. 1 picture has a placeholder: the clipboard holds no picture files. ' +
      'Drop a file onto a placeholder to fill it. Placeholders mark 1 kanban object: their content is not on the ' +
      'clipboard. 1 connector was left out (an end was not copied).',
  );
});

test('a picture placeholder is filled in place, keeping its id, crop and connectors', () => {
  const copy = copyOf([
    // A 2000 × 1000 picture cropped to its right half (1000 × 1000), shown at half size: 500 × 500 at (0, 0).
    [
      'image',
      {
        ...placed(0, 0),
        scale: { scale: 0.5 },
        crop: { x: 1000, y: 0, width: 1000, height: 1000 },
        resource: { id: '777', width: 2000, height: 1000 },
      },
    ],
    ['sticker', { ...placed(600, 0), scale: { scale: 1 }, size: { width: 200, height: 230 }, text: '<p>See</p>' }],
    ['line', { primary: { widgetIndex: 1 }, secondary: { widgetIndex: 0 }, style: '{}' }],
  ]);
  const paste = readWhiteboardClipboard(clipboardHtml(copy))!,
    board = parseBoard({ version: 1, title: 't', items: paste.payload.items }),
    holder = board.items.find(i => i.sourceImage)!;
  assert.deepEqual(holder.sourceImage?.crop, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.deepEqual([holder.x, holder.y, holder.w, holder.h], [-250, -250, 500, 500]);
  assert.equal(picturePlaceholderAt(board, { x: 0, y: 0 })?.id, holder.id);
  assert.equal(picturePlaceholderAt(board, { x: 600, y: 0 }), undefined);

  const asset = { mime: 'image/png', data: 'data:image/png;base64,AAAA', width: 2000, height: 1000, name: 'plan.png' };
  const filled = parseBoard(fillPicturePlaceholder(board, holder.id, 'asset-1', asset)),
    image = filled.items.find(i => i.id === holder.id)!;
  // Same id, place and size; the copied crop is applied; it is a real image now, at the same stacking position.
  assert.equal(image.type, 'image');
  assert.equal(image.assetId, 'asset-1');
  assert.deepEqual([image.x, image.y, image.w, image.h], [-250, -250, 500, 500]);
  assert.deepEqual(image.crop, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.equal(image.sourceImage, undefined);
  assert.equal(
    filled.items.findIndex(i => i.id === holder.id),
    board.items.findIndex(i => i.id === holder.id),
  );
  assert.equal(filled.items.find(i => i.type === 'arrow')!.to, holder.id);

  // A file with other proportions (square, so its cropped half is 1 : 2) is fitted inside, centred, not stretched.
  const tall = fillPicturePlaceholder(board, holder.id, 'asset-2', { ...asset, width: 1000, height: 1000 });
  const fitted = tall.items.find(i => i.id === holder.id)!;
  assert.deepEqual([fitted.x, fitted.y, fitted.w, fitted.h], [-125, -250, 250, 500]);
  // Not a placeholder: nothing changes.
  const note = board.items.find(i => i.type === 'note')!;
  assert.equal(fillPicturePlaceholder(board, note.id, 'asset-3', asset), board);
});

test('a board rejects a malformed picture placeholder', () => {
  const item = readWhiteboardClipboard(clipboardHtml(FIXTURE))!.payload.items.find(i => i.sourceImage)!;
  const load = (sourceImage: unknown) => parseBoard({ version: 1, title: 't', items: [{ ...item, sourceImage }] });
  load({});
  load({ board: 'b1', crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
  const bad = [
    null,
    'x',
    { board: 'a b' },
    { item: 5 },
    { board: 'x'.repeat(81) },
    { crop: { x: 0.8, y: 0, w: 0.5, h: 1 } },
  ];
  for (const value of bad) assert.throws(() => load(value), /Invalid picture placeholder/);
});

test('the payload pastes with fresh ids and keeps the connector attached', () => {
  const paste = readWhiteboardClipboard(clipboardHtml(FIXTURE))!;
  const result = pastePayload({ version: 1, title: 'Target', items: [] }, paste.payload, { x: 0, y: 0 });
  const board = parseBoard(result.board),
    line = board.items.find(i => i.type === 'arrow')!;
  assert.equal(board.items.length, 9);
  assert.ok(paste.payload.items.every(i => !board.items.some(b => b.id === i.id)));
  assert.equal(board.items.find(i => i.id === line.from)?.type, 'note');
  // The top-left of the copy lands on the paste point.
  assert.equal(Math.min(...board.items.filter(i => i.type !== 'arrow').map(i => i.x)), 0);
});

test('a protected copy is refused, an empty one says so, and the object limit is kept', () => {
  assert.throws(() => readWhiteboardClipboard(clipboardHtml({ ...FIXTURE, isProtected: true })), {
    message: PROTECTED_MESSAGE,
  });
  assert.throws(() => readWhiteboardClipboard(clipboardHtml(copyOf([]))), /Nothing in this copy/);
  const limited = readWhiteboardClipboard(clipboardHtml(FIXTURE), 3)!;
  assert.equal(limited.payload.items.length, 3);
  assert.ok(limited.report.overLimit > 0);
});

test('unknown shape numbers are drawn as rectangles and counted; odd values never throw', () => {
  const copy = copyOf([
    ['shape', { ...placed(0, 0), scale: { scale: 1 }, size: { width: 100, height: 100 }, shape: '99', style: '{' }],
    ['shape', { ...placed(200, 0), scale: { scale: 1 }, size: { width: 100, height: 100 }, shape: '4', style: 7 }],
    ['sticker', { _position: null, size: { width: 'wide' } }],
    ['text', { ...placed(0, 0), scale: { scale: 'x' }, size: { width: 64, height: 20 }, text: 12 }],
  ]);
  (copy.data.objects as unknown[]).push(null, 'junk', { widgetData: { type: 'shape' } });
  const paste = readWhiteboardClipboard(clipboardHtml(copy))!;
  assert.deepEqual(paste.payload.items.map(i => i.type).sort(), ['ellipse', 'rectangle', 'text']);
  assert.equal(paste.report.approximated, 1);
  assert.equal(paste.report.skipped.unsupported, 4);
});

test('a copied icon becomes an Icon object when its code is known', () => {
  const icon = (code: string, x: number, extra: Record<string, unknown> = {}) =>
    [
      'mockup',
      {
        ...placed(x, 0),
        scale: { scale: 2 },
        size: { width: 48, height: 48 },
        mockup: { info: JSON.stringify({ icon: code, text: '' }), type: 'WIREFRAMES_ICON_2020' },
        style: JSON.stringify({ bc: 0, fw: 0, tc: 0x1c7ed6 }),
        ...extra,
      },
    ] as [string, Record<string, unknown>];
  const copy = copyOf([
    icon('f07c', 0),
    // Upper-case codes are read too; an extra drawn icon; a code nobody knows; a mockup that is not an icon.
    icon('F015', 200),
    icon('f6ed', 400),
    icon('zzzz', 600),
    icon('f07c', 800, { mockup: { info: '{}', type: 'WIREFRAMES_BUTTON' } }),
    ['line', { primary: { widgetIndex: 1 }, secondary: { widgetIndex: 0 }, style: '{}' }],
  ]);
  const paste = readWhiteboardClipboard(clipboardHtml(copy))!,
    board = parseBoard({ version: 1, title: 't', items: paste.payload.items }),
    icons = board.items.filter(i => i.type === 'icon');
  assert.deepEqual(
    icons.map(i => [i.data?.name, i.x, i.y, i.w, i.h, i.fill]),
    [
      ['FolderOpen', -48, -48, 96, 96, '#1c7ed6'],
      ['House', 152, -48, 96, 96, '#1c7ed6'],
      ['Hippo', 352, -48, 96, 96, '#1c7ed6'],
    ],
  );
  // Pasted icons use the solid drawings, the closer likeness of the copied icon.
  assert.ok(icons.every(i => i.data?.set === 'solid'));
  // The connector between two icons stays attached to them.
  const line = board.items.find(i => i.type === 'arrow')!;
  assert.deepEqual([line.from, line.to], [icons[1].id, icons[0].id]);
  // Unknown code and other wireframe parts keep a placeholder.
  assert.equal(board.items.filter(i => i.text === 'Icon object (not copied)').length, 1);
  assert.equal(board.items.filter(i => i.text === 'Wireframe object (not copied)').length, 1);
  assert.deepEqual(paste.report.placeholders, { ICON: 1, WIREFRAME: 1 });
  assert.equal(paste.report.imported.icon, 3);
});
