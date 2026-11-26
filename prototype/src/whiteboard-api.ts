// Optional picture download for objects pasted from another whiteboard (whiteboard-clipboard.ts). Pure apart from
// the injected `fetch` and the storage helpers. Nothing here runs unless the person has saved an API address and
// an access token in Preferences. The calls follow that service's public REST API, as scripts/export-whiteboard.mjs
// does: the token is only ever sent to the saved address, and the picture file itself is fetched from a
// pre-signed address without the token.
import { imageMimes } from './model-ext.ts';

export type WhiteboardApi = { api: string; token: string };
export const WHITEBOARD_API_KEY = 'boardroom.whiteboard-api.v1';
/** Largest picture file downloaded; the image pipeline scales big pictures down afterwards. */
export const MAX_DOWNLOAD_BYTES = 50_000_000;
const TOKEN = /^[\x21-\x7e]{8,4000}$/;

/** The API address as an https origin. Throws a message for the settings dialog when it is not one. */
export function normalizeApiAddress(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the full address, starting with https://');
  }
  if (url.protocol !== 'https:') throw new Error('The address must start with https://');
  if (url.username || url.password) throw new Error('The address must not contain a user name or password.');
  return url.origin;
}
/** Stored settings, or null when missing or not valid. */
export function parseWhiteboardApi(raw: string | null | undefined): WhiteboardApi | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v.api !== 'string' || typeof v.token !== 'string' || !TOKEN.test(v.token)) return null;
    return { api: normalizeApiAddress(v.api), token: v.token };
  } catch {
    return null;
  }
}
export const isValidToken = (token: string) => TOKEN.test(token);
export function loadWhiteboardApi(): WhiteboardApi | null {
  try {
    return parseWhiteboardApi(localStorage.getItem(WHITEBOARD_API_KEY));
  } catch {
    return null;
  }
}
/** Save the settings, or remove them with null. False when the browser could not store them. */
export function saveWhiteboardApi(settings: WhiteboardApi | null): boolean {
  try {
    if (settings) localStorage.setItem(WHITEBOARD_API_KEY, JSON.stringify(settings));
    else localStorage.removeItem(WHITEBOARD_API_KEY);
    return true;
  } catch {
    return false;
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const quiet: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };

/** GET JSON from the saved API address with the token. Any other host is refused before the request is made. */
async function apiGet(settings: WhiteboardApi, url: URL, fetchFn: Fetch): Promise<unknown> {
  if (url.origin !== settings.api) throw new Error('The picture is on another server; the token was not sent.');
  let res: Response;
  try {
    res = await fetchFn(url.href, {
      ...quiet,
      headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json' },
    });
  } catch {
    throw new Error('The whiteboard API could not be reached.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('The access token was refused.');
  if (res.status === 404) throw new Error('The picture was not found with this token.');
  if (res.status === 429) throw new Error('The whiteboard API is limiting requests; try again in a minute.');
  if (!res.ok) throw new Error(`The whiteboard API answered ${res.status}.`);
  return res.json();
}
const field = (v: unknown, key: string): unknown =>
  v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;

/**
 * Download one picture of a board: look the image object up, ask for its file address (the original, then the
 * preview when the original is not a web image), and fetch the file. Throws a readable message on failure.
 */
export async function fetchSourcePicture(
  settings: WhiteboardApi,
  ref: { board: string; item: string },
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<{ blob: Blob; mime: string; name: string }> {
  const path = `/v2/boards/${encodeURIComponent(ref.board)}/images/${encodeURIComponent(ref.item)}`,
    data = field(await apiGet(settings, new URL(path, settings.api), fetchFn), 'data'),
    imageUrl = field(data, 'imageUrl'),
    title = field(data, 'title');
  if (typeof imageUrl !== 'string') throw new Error('The whiteboard API gave no file for this picture.');
  for (const format of ['original', 'preview']) {
    const resource = new URL(imageUrl, settings.api);
    resource.searchParams.set('format', format);
    resource.searchParams.set('redirect', 'false');
    const fileUrl = field(await apiGet(settings, resource, fetchFn), 'url');
    if (typeof fileUrl !== 'string' || !fileUrl.startsWith('https://')) break;
    let res: Response;
    try {
      // The file address is pre-signed: fetched without the token.
      res = await fetchFn(fileUrl, quiet);
    } catch {
      throw new Error('The picture file could not be downloaded (its server did not allow it).');
    }
    if (!res.ok) continue;
    const blob = await res.blob(),
      mime = blob.type.split(';')[0].trim().toLowerCase();
    if (!imageMimes.includes(mime)) continue;
    if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error('The picture file is too large.');
    const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Pasted picture';
    return { blob, mime, name };
  }
  throw new Error('The picture file could not be downloaded.');
}
