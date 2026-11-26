// Paste objects copied in another whiteboard app. Pure: no React, no DOM.
// That app puts a data block in the clipboard's HTML next to the plain text: base64 of JSON whose bytes are each
// raised by a fixed offset. The JSON lists the copied objects ("widgets") with centre positions, a base size and a
// scale, numeric colours and a style string. The shapes below were read from a real copy (2026-11-26), not from
// any documentation, so every field is read defensively and anything unknown becomes a placeholder or is counted.
// The objects are rewritten into the REST export shape and handed to the existing import (whiteboard-import.ts),
// so both paths share one mapping to Boardroom objects. Picture files are not on the clipboard.
import { createItem, parseBoard } from './model.ts';
import type { Board, ImageAsset, Item } from './model.ts';
import { SOURCE_ID } from './model-ext.ts';
import { ICON_BY_CODE, SOLID_BY_CODE } from './icon-codes.ts';
import { CLIP_FORMAT } from './clipboard.ts';
import type { ClipPayload } from './clipboard.ts';
import { importWhiteboardRest, stickyColors, typeLabel, WHITEBOARD_FORMAT } from './whiteboard-import.ts';
import type { WhiteboardImportReport } from './whiteboard-import.ts';

type Json = Record<string, unknown>;
type XY = { x: number; y: number };
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const obj = (v: unknown): Json => (isObj(v) ? v : {});

// The source app's clipboard marker. This literal is the one place the app source names that product
// (allowed for this file only by tests/repo-rules.test.ts); menus and messages say "another whiteboard".
const MARKER = 'miro-data-v1';
const BLOCK = new RegExp(`\\(${MARKER}\\)([A-Za-z0-9+/=]+)\\(/${MARKER}\\)`);
/** Each byte of the JSON text is stored raised by this amount. */
const BYTE_OFFSET = 59;
/** Largest clipboard HTML read, and the most objects taken from one copy. */
const MAX_HTML = 40_000_000,
  MAX_OBJECTS = 5000;

/** The data block of a copy made in the other whiteboard, or null when the HTML has none or it does not decode. */
export function decodeWhiteboardClipboard(html: string): Json | null {
  if (!html || html.length > MAX_HTML) return null;
  const m = BLOCK.exec(html);
  if (!m) return null;
  try {
    const packed = atob(m[1]),
      bytes = new Uint8Array(packed.length);
    for (let k = 0; k < packed.length; k++) bytes[k] = (packed.charCodeAt(k) - BYTE_OFFSET) & 255;
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isObj(json) && isObj(json.data) && Array.isArray(json.data.objects) ? json : null;
  } catch {
    return null;
  }
}

/** A colour stored as a whole number (0xRRGGBB); negative means "none". */
const colour = (v: unknown): string | undefined => {
  const n = num(v);
  return n === undefined || n < 0 || n > 0xffffff ? undefined : `#${Math.round(n).toString(16).padStart(6, '0')}`;
};
const rgb = (hex: string) => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
/** The sticky colour name whose Boardroom colour is nearest to a copied note's colour. */
function stickyName(hex: string | undefined): string {
  if (!hex) return 'light_yellow';
  const [r, g, b] = rgb(hex);
  let best = 'light_yellow',
    bestDistance = Infinity;
  for (const [name, value] of Object.entries(stickyColors)) {
    const [r2, g2, b2] = rgb(value),
      d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDistance) [best, bestDistance] = [name, d];
  }
  return best;
}
/**
 * Shape numbers to the shape names the import knows. Only 3 (rectangle) was seen in a real copy; the others follow
 * that app's published plugin enum and are unverified. An unknown number is drawn as a rectangle and counted.
 */
const shapeNames: Record<string, string> = {
  3: 'rectangle',
  4: 'circle',
  5: 'triangle',
  6: 'wedge_round_rectangle_callout',
  7: 'round_rectangle',
  8: 'rhombus',
  10: 'parallelogram',
  11: 'star',
  12: 'right_arrow',
  13: 'left_arrow',
  15: 'round_rectangle',
  16: 'pentagon',
  17: 'hexagon',
  18: 'octagon',
  19: 'trapezoid',
  20: 'flow_chart_predefined_process',
  21: 'left_right_arrow',
  22: 'cloud',
  23: 'left_brace',
  24: 'right_brace',
  25: 'cross',
  26: 'can',
};
const aligns: Record<string, string> = { l: 'left', c: 'center', r: 'right' },
  valigns: Record<string, string> = { t: 'top', m: 'middle', b: 'bottom' };
/** Line and border style numbers: 2 is solid (seen); 0 dashed and 1 dotted are unverified. */
const dashOf = (v: unknown) => (num(v) === 0 ? 'dashed' : num(v) === 1 ? 'dotted' : 'normal');
/** Connector path numbers: 1 is an elbow (seen); 0 straight and 2 curved are unverified. */
const pathOf = (v: unknown) => (num(v) === 0 ? 'straight' : num(v) === 1 ? 'elbowed' : 'curved');
/** A widget's style is a JSON string of short keys. */
const styleOf = (j: Json): Json => {
  try {
    return obj(typeof j.style === 'string' ? JSON.parse(j.style) : j.style);
  } catch {
    return {};
  }
};

type Widget = { j: Json; type: string; style: Json; scale: number };
const pointsOf = (j: Json): XY[] =>
  (Array.isArray(j.points) ? j.points : [])
    .slice(0, 20000)
    .map(p => ({ x: num(obj(p).x), y: num(obj(p).y) }))
    .filter((p): p is XY => p.x !== undefined && p.y !== undefined);
/** On-board size: the base size times the widget's scale. Pictures use their crop, pen strokes their points. */
function sizeOf(w: Widget): { w: number; h: number } | undefined {
  const { j, scale } = w;
  let width: number | undefined, height: number | undefined;
  if (w.type === 'paint') {
    const pts = pointsOf(j);
    if (pts.length < 2) return undefined;
    width = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
    height = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  } else if (w.type === 'image') {
    width = num(obj(j.crop).width) ?? num(obj(j.resource).width);
    height = num(obj(j.crop).height) ?? num(obj(j.resource).height);
  } else {
    width = num(obj(j.size).width) ?? num(j.width);
    height = num(obj(j.size).height) ?? num(j.height);
  }
  if (width === undefined || height === undefined || width < 0 || height < 0) return undefined;
  return { w: Math.max(1, width * scale), h: Math.max(1, height * scale) };
}
/** Centre on the canvas. A widget inside a frame is placed from the frame's top-left corner. */
function centreOf(widgets: (Widget | null)[], k: number, depth = 0): XY | undefined {
  const w = widgets[k];
  if (!w) return undefined;
  const pos = obj(w.j._position),
    off = obj(pos.offsetPx),
    x = num(off.x) ?? num(w.j.x),
    y = num(off.y) ?? num(w.j.y);
  if (x === undefined || y === undefined) return undefined;
  const parent = num(obj(w.j._parent).index);
  if (pos.schema !== 'parentOffsetPx' || parent === undefined || depth > 20) return { x, y };
  const pc = centreOf(widgets, parent, depth + 1),
    ps = widgets[parent] ? sizeOf(widgets[parent]!) : undefined;
  return pc && ps ? { x: pc.x - ps.w / 2 + x, y: pc.y - ps.h / 2 + y } : { x, y };
}

/** Data and style of one widget in the REST export shape, or null for kinds handled elsewhere or unknown. */
function restParts(w: Widget, size: { w: number; h: number }): { type: string; data: Json; style: Json } | null {
  const { j, style: s, scale } = w;
  const textAlign = aligns[str(s.ta)],
    textAlignVertical = valigns[str(s.tav)];
  switch (w.type) {
    case 'sticker':
      return {
        type: 'sticky_note',
        data: { content: str(j.text), shape: size.w / size.h > 1.4 ? 'rectangle' : 'square' },
        style: { fillColor: stickyName(colour(s.sbc)), textAlign, textAlignVertical },
      };
    case 'shape': {
      const code = str(j.shape) || str(s.st),
        fontSize = num(s.fs);
      return {
        type: 'shape',
        // A number maps through the table; a name (newer shapes) is passed on as it is.
        data: { content: str(j.text), shape: /^\d+$/.test(code) ? (shapeNames[code] ?? `shape_${code}`) : code },
        style: {
          fillColor: colour(s.bc),
          fillOpacity: colour(s.bc) ? (num(s.bo) ?? 1) : 0,
          borderColor: colour(s.brc),
          borderWidth: num(s.brw) === undefined ? undefined : num(s.brw)! * scale,
          borderOpacity: colour(s.brc) ? num(s.bro) : 0,
          borderStyle: dashOf(s.brs),
          color: colour(s.tc),
          fontSize: fontSize ? fontSize * scale : undefined,
          textAlign,
          textAlignVertical,
        },
      };
    }
    case 'text':
      return {
        type: 'text',
        data: { content: str(j.text) },
        style: {
          color: colour(s.tc),
          // A text box has no font size of its own: the base size (14) grows with its scale.
          fontSize: (num(s.fs) || 14) * scale,
          textAlign,
          fillColor: colour(s.bc),
          fillOpacity: colour(s.bc) ? (num(s.bo) ?? 1) : 0,
        },
      };
    case 'frame':
      return { type: 'frame', data: { title: str(j.text) }, style: { fillColor: colour(s.bc) } };
    case 'embed': {
      const c = obj(j.custom_data),
        url = str(c.url) || str(c.org_url);
      if (!url) return null;
      return {
        type: 'preview',
        data: { url, title: str(c.title), description: str(c.description), providerName: str(c.provider_name) },
        style: {},
      };
    }
    default:
      return null;
  }
}
/**
 * Kinds with nothing usable on the clipboard keep their place as a placeholder. Their type is written in upper
 * case on purpose: the import only knows lower-case type names, so it never mistakes one for a kind it can read.
 */
const placeholderType = (w: Widget) =>
  w.type === 'mockup'
    ? str(obj(w.j.mockup).type).includes('ICON')
      ? 'ICON'
      : 'WIREFRAME'
    : (w.type || 'unknown').toUpperCase().slice(0, 40);

/** A pen stroke as a Boardroom pen object (the REST shape has no strokes). */
function strokeItem(w: Widget, centre: XY, size: { w: number; h: number }): Item | null {
  const pts = pointsOf(w.j),
    minX = Math.min(...pts.map(p => p.x)),
    minY = Math.min(...pts.map(p => p.y));
  const item = createItem('pen', Math.round(centre.x - size.w / 2), Math.round(centre.y - size.h / 2));
  item.w = Math.max(1, Math.round(size.w));
  item.h = Math.max(1, Math.round(size.h));
  item.points = pts.map(p => ({
    x: Math.round((p.x - minX) * w.scale * 10) / 10,
    y: Math.round((p.y - minY) * w.scale * 10) / 10,
  }));
  item.fill = colour(w.style.lc) ?? item.fill;
  item.data = { style: 'pen', width: Math.max(1, Math.min(24, Math.round((num(w.style.t) ?? 2) * w.scale))) };
  try {
    parseBoard({ version: 1, title: 'check', items: [item] });
    return item;
  } catch {
    return null;
  }
}

/** The Boardroom icon for a copied icon: its icon font code is looked up in icon-codes.ts. */
function iconName(j: Json): { name: string; set?: 'solid' } | undefined {
  const mockup = obj(j.mockup);
  if (!str(mockup.type).includes('ICON')) return undefined;
  try {
    const code = str(obj(typeof mockup.info === 'string' ? JSON.parse(mockup.info) : mockup.info).icon);
    const key = code.toLowerCase();
    // The solid icon is the closer likeness; the outline match is the fallback.
    if (Object.hasOwn(SOLID_BY_CODE, key)) return { name: SOLID_BY_CODE[key], set: 'solid' };
    return Object.hasOwn(ICON_BY_CODE, key) ? { name: ICON_BY_CODE[key] } : undefined;
  } catch {
    return undefined;
  }
}
type PictureRef = NonNullable<Item['sourceImage']>;
/** Text shown on a picture's placeholder. */
export const PICTURE_HINT = 'Picture: drop the file here';
/** Where a copied picture lives in the other app (board and object id) and its crop as fractions of the file. */
function pictureRef(root: Json, entry: Json, j: Json): PictureRef {
  const ref: PictureRef = {},
    board = str(obj(entry.meta).boardId) || str(root.boardId),
    item = str(entry.initialId);
  if (SOURCE_ID.test(board)) ref.board = board;
  if (SOURCE_ID.test(item)) ref.item = item;
  const c = obj(j.crop),
    full = { w: num(obj(j.resource).width), h: num(obj(j.resource).height) },
    [x, y, w, h] = [num(c.x), num(c.y), num(c.width), num(c.height)];
  if (full.w && full.h && x !== undefined && y !== undefined && w && h) {
    const crop = { x: x / full.w, y: y / full.h, w: w / full.w, h: h / full.h },
      inside = crop.x >= 0 && crop.y >= 0 && crop.w >= 0.01 && crop.h >= 0.01,
      fits = crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001;
    if (inside && fits && (crop.w < 0.999 || crop.h < 0.999)) ref.crop = crop;
  }
  return ref;
}
/** The topmost picture placeholder under a board point. */
export const picturePlaceholderAt = (board: Board, p: XY): Item | undefined =>
  [...board.items]
    .reverse()
    .find(i => i.sourceImage && !i.locked && p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h);
/**
 * Replace a picture placeholder by the picture, keeping its id (so connectors, groups and links stay), its place
 * in the stacking order and its copied crop. The picture is fitted inside the placeholder, centred, without
 * distortion. Returns the board unchanged when `id` is not a placeholder.
 */
export function fillPicturePlaceholder(
  board: Board,
  id: string,
  assetId: string,
  asset: ImageAsset,
  originalAssetId?: string,
): Board {
  const target = board.items.find(i => i.id === id && i.sourceImage);
  if (!target) return board;
  const crop = target.sourceImage!.crop,
    aspect = ((crop?.w ?? 1) * asset.width) / ((crop?.h ?? 1) * asset.height),
    w = Math.min(target.w, target.h * aspect),
    h = w / aspect;
  const image: Item = {
    ...createItem('image', target.x + (target.w - w) / 2, target.y + (target.h - h) / 2),
    id,
    w,
    h,
    assetId,
    text: asset.name.slice(0, 200),
    ...(crop ? { crop } : {}),
    ...(originalAssetId ? { originalAssetId } : {}),
    ...(target.group ? { group: target.group } : {}),
    ...(target.layer ? { layer: target.layer } : {}),
    ...(target.rotation ? { rotation: target.rotation } : {}),
  };
  return { ...board, items: board.items.map(i => (i.id === id ? image : i)) };
}

export type WhiteboardPaste = { payload: ClipPayload; report: WhiteboardImportReport; strokes: number };
/** Thrown when the source board forbids copying its content; the paste is refused. */
export const PROTECTED_MESSAGE = 'The board these objects were copied from does not allow copying its content.';

/**
 * Objects copied in the other whiteboard, as a paste payload. Null when the HTML is not such a copy. Throws when
 * the copy is marked protected or holds nothing that can be placed.
 */
export function readWhiteboardClipboard(html: string, limit = 2000): WhiteboardPaste | null {
  const root = decodeWhiteboardClipboard(html);
  if (!root) return null;
  if (root.isProtected === true) throw new Error(PROTECTED_MESSAGE);
  const raw = (obj(root.data).objects as unknown[]).slice(0, MAX_OBJECTS);
  const widgets: (Widget | null)[] = raw.map(o => {
    const wd = obj(obj(o).widgetData),
      j = obj(wd.json);
    if (!isObj(wd.json) || !str(wd.type)) return null;
    return { j, type: str(wd.type), style: styleOf(j), scale: Math.max(0.001, num(obj(j.scale).scale) ?? 1) };
  });
  const items: Json[] = [],
    connectors: Json[] = [],
    strokes: Item[] = [],
    pictures = new Map<string, PictureRef>(),
    icons = new Map<string, { data: { name: string; set?: 'solid' }; fill?: string }>();
  let loose = 0,
    unread = 0;
  widgets.forEach((w, k) => {
    if (!w) return void unread++;
    if (w.type === 'line') {
      const from = num(obj(w.j.primary).widgetIndex),
        to = num(obj(w.j.secondary).widgetIndex);
      // Only connectors attached at both ends are understood; the shape of a loose end is unknown.
      if (from === undefined || to === undefined || !widgets[from] || !widgets[to]) return void loose++;
      const s = w.style,
        captions = Array.isArray(obj(w.j.line).captions) ? (obj(w.j.line).captions as unknown[]) : [];
      connectors.push({
        id: `c${k}`,
        startItem: { id: String(from) },
        endItem: { id: String(to) },
        shape: pathOf(s.lt),
        style: {
          strokeColor: colour(s.lc),
          strokeWidth: num(s.t),
          strokeStyle: dashOf(s.ls),
          // 0 is no head (seen at a start); any other number is drawn as an arrow.
          startStrokeCap: num(s.a_start) ? 'unknown' : 'none',
          endStrokeCap: num(s.a_end) ? 'unknown' : 'none',
        },
        captions: captions.map(c => ({ content: str(obj(c).text) })).filter(c => c.content),
      });
      return;
    }
    const centre = centreOf(widgets, k),
      size = sizeOf(w);
    if (!centre || !size) return void unread++;
    if (w.type === 'paint') {
      const stroke = strokeItem(w, centre, size);
      if (stroke) strokes.push(stroke);
      else unread++;
      return;
    }
    if (w.type === 'image') pictures.set(String(k), pictureRef(root, obj(raw[k]), w.j));
    const icon = w.type === 'mockup' ? iconName(w.j) : undefined;
    if (icon) icons.set(String(k), { data: icon, fill: colour(w.style.tc) });
    const parts = restParts(w, size) ?? { type: placeholderType(w), data: {}, style: {} };
    items.push({
      id: String(k),
      ...parts,
      position: { x: centre.x, y: centre.y, origin: 'center', relativeTo: 'canvas_center' },
      geometry: { width: size.w, height: size.h, rotation: num(obj(w.j.rotation).rotation) ?? 0 },
    });
  });
  const made = importWhiteboardRest(
    { format: WHITEBOARD_FORMAT, board: {}, items, connectors },
    Math.max(0, limit - strokes.length),
  );
  const report = made.report;
  report.danglingConnectors += loose;
  if (unread) report.skipped.unsupported = (report.skipped.unsupported ?? 0) + unread;
  const pictureOf = new Map([...pictures].map(([k, ref]) => [made.itemIds[k], ref])),
    iconOf = new Map([...icons].map(([k, icon]) => [made.itemIds[k], icon]));
  const placed = [...made.board.items, ...strokes].map(i => {
    // An icon with a known code becomes an Icon object: square, centred in the copied box, same id.
    const icon = iconOf.get(i.id);
    if (icon) {
      const side = Math.min(i.w, i.h),
        made = createItem('icon', Math.round(i.x + (i.w - side) / 2), Math.round(i.y + (i.h - side) / 2));
      report.placeholders.ICON -= 1;
      if (!report.placeholders.ICON) delete report.placeholders.ICON;
      report.imported.icon = (report.imported.icon ?? 0) + 1;
      return { ...made, id: i.id, w: side, h: side, data: icon.data, fill: icon.fill ?? made.fill };
    }
    // A picture's placeholder remembers where the picture lives and its crop, and says how to fill it.
    const picture = pictureOf.get(i.id);
    if (picture) return { ...i, text: PICTURE_HINT, name: 'Picture placeholder', sourceImage: picture };
    // The import's placeholder wording is about export files.
    if (i.text.endsWith('(not exported)')) return { ...i, text: i.text.replace('(not exported)', '(not copied)') };
    // A copied text box is exactly as wide as its text in the other app's font. Here the same words can be a
    // little wider and wrap, and a fixed height then hid the second line ("TEXT BOX" showed as "TEXT",
    // 2026-11-26): give the box some slack and let its height follow the text.
    if (i.type === 'text') return { ...i, w: Math.round(i.w * 1.15 + 16), format: { ...i.format, autoHeight: true } };
    return i;
  });
  if (!placed.length) throw new Error('Nothing in this copy could be pasted.');
  const xs = placed.flatMap(i => [i.x, i.x + i.w]),
    ys = placed.flatMap(i => [i.y, i.y + i.h]),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    payload: {
      format: CLIP_FORMAT,
      version: 1,
      items: placed,
      groups: made.board.groups ?? [],
      datasets: {},
      assets: {},
      bounds: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    },
    report,
    strokes: strokes.length,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
/** One-line summary of a paste: what was placed and what the clipboard could not give. */
export function whiteboardPasteNote(p: WhiteboardPaste): string {
  const r = p.report,
    list = (m: Record<string, number>) =>
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${n.toLocaleString('en')} ${typeLabel(t, n)}`)
        .join(', ');
  const parts = [`Pasted ${plural(p.payload.items.length, 'object', 'objects')} from another whiteboard.`];
  const pictures = p.payload.items.filter(i => i.sourceImage).length,
    // Pictures are reported on their own: unlike other placeholders, they can be filled.
    others = Object.fromEntries(Object.entries(r.placeholders).filter(([t]) => t !== 'IMAGE'));
  if (pictures)
    parts.push(
      `${plural(pictures, 'picture has', 'pictures have')} a placeholder: the clipboard holds no picture files. Drop a file onto a placeholder to fill it.`,
    );
  if (Object.keys(others).length)
    parts.push(`Placeholders mark ${list(others)}: their content is not on the clipboard.`);
  if (Object.keys(r.skipped).length) parts.push(`Left out ${list(r.skipped)}.`);
  if (r.danglingConnectors)
    parts.push(`${plural(r.danglingConnectors, 'connector was', 'connectors were')} left out (an end was not copied).`);
  if (r.overLimit) parts.push(`${plural(r.overLimit, 'object', 'objects')} did not fit the board's object limit.`);
  if (r.approximated) parts.push(`${plural(r.approximated, 'shape is', 'shapes are')} drawn as the nearest shape.`);
  return parts.join(' ');
}
