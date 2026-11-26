// Picture download for pasted objects: the requests follow the public REST API reference; every response here is
// made up, and no test touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSourcePicture, isValidToken, normalizeApiAddress, parseWhiteboardApi } from '../src/whiteboard-api.ts';

const settings = { api: 'https://api.whiteboard.example', token: 'secret-token-123' };
const ref = { board: 'bFictional1=', item: '900000000000000006' };
type Call = { url: string; auth: string | null; credentials?: string };
/** A fetch stand-in answering from a table of address → response, recording each call. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization'), credentials: init?.credentials });
    const route = routes[url];
    if (!route) throw new TypeError('network error');
    return route();
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const png = () => new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
const ITEM = 'https://api.whiteboard.example/v2/boards/bFictional1%3D/images/900000000000000006',
  RESOURCE = 'https://api.whiteboard.example/v2/boards/bFictional1%3D/resources/images/777',
  ORIGINAL = `${RESOURCE}?format=original&redirect=false`,
  PREVIEW = `${RESOURCE}?format=preview&redirect=false`,
  FILE = 'https://files.whiteboard.example/signed/777?sig=abc';
const item = () => json({ id: ref.item, data: { title: ' Plan ', imageUrl: PREVIEW } });

test('settings: only an https address and a plausible token are accepted', () => {
  assert.equal(normalizeApiAddress(' https://api.whiteboard.example/v2/ '), 'https://api.whiteboard.example');
  for (const bad of ['api.whiteboard.example', 'http://api.whiteboard.example', 'https://u:p@api.whiteboard.example'])
    assert.throws(() => normalizeApiAddress(bad));
  assert.ok(isValidToken('secret-token-123'));
  assert.ok(!isValidToken('short'));
  assert.ok(!isValidToken('has a space in it'));
  assert.deepEqual(parseWhiteboardApi(JSON.stringify({ ...settings, api: settings.api + '/x' })), settings);
  for (const raw of [null, '', 'nope', '{}', JSON.stringify({ api: 'http://a.example', token: settings.token })])
    assert.equal(parseWhiteboardApi(raw), null);
});

test('a picture is looked up, its file address requested, and the file fetched without the token', async () => {
  const { fn, calls } = fakeFetch({ [ITEM]: item, [ORIGINAL]: () => json({ url: FILE }), [FILE]: png });
  const got = await fetchSourcePicture(settings, ref, fn);
  assert.equal(got.mime, 'image/png');
  assert.equal(got.name, 'Plan');
  assert.equal(got.blob.size, 4);
  assert.deepEqual(
    calls.map(c => [c.url, c.auth]),
    [
      [ITEM, 'Bearer secret-token-123'],
      [ORIGINAL, 'Bearer secret-token-123'],
      [FILE, null],
    ],
  );
  assert.ok(calls.every(c => c.credentials === 'omit'));
});

test('the preview is used when the original is not a web image', async () => {
  const { fn } = fakeFetch({
    [ITEM]: item,
    [ORIGINAL]: () => json({ url: `${FILE}&o=1` }),
    [`${FILE}&o=1`]: () => new Response(new Blob(['%PDF'], { type: 'application/pdf' })),
    [PREVIEW]: () => json({ url: FILE }),
    [FILE]: png,
  });
  assert.equal((await fetchSourcePicture(settings, ref, fn)).mime, 'image/png');
});

test('the token never leaves the saved address, and failures give readable messages', async () => {
  // The API points at a file resource on another host: refused before any request carries the token there.
  const elsewhere = fakeFetch({
    [ITEM]: () => json({ data: { imageUrl: 'https://evil.example/v2/boards/x/resources/images/1' } }),
  });
  await assert.rejects(fetchSourcePicture(settings, ref, elsewhere.fn), /another server; the token was not sent/);
  assert.deepEqual(
    elsewhere.calls.map(c => c.url),
    [ITEM],
  );
  const failing = (status: number) => fakeFetch({ [ITEM]: () => json({}, status) }).fn;
  await assert.rejects(fetchSourcePicture(settings, ref, failing(401)), /access token was refused/);
  await assert.rejects(fetchSourcePicture(settings, ref, failing(404)), /not found with this token/);
  await assert.rejects(fetchSourcePicture(settings, ref, failing(429)), /limiting requests/);
  await assert.rejects(fetchSourcePicture(settings, ref, failing(500)), /answered 500/);
  await assert.rejects(fetchSourcePicture(settings, ref, fakeFetch({}).fn), /could not be reached/);
  const empty = fakeFetch({ [ITEM]: () => json({ data: {} }) });
  await assert.rejects(fetchSourcePicture(settings, ref, empty.fn), /no file/);
  // The signed file address cannot be fetched (for example blocked by the file server).
  const blocked = fakeFetch({ [ITEM]: item, [ORIGINAL]: () => json({ url: FILE }) });
  await assert.rejects(fetchSourcePicture(settings, ref, blocked.fn), /its server did not allow it/);
  // A file address that is not https is never fetched.
  const plain = fakeFetch({ [ITEM]: item, [ORIGINAL]: () => json({ url: 'http://files.whiteboard.example/777' }) });
  await assert.rejects(fetchSourcePicture(settings, ref, plain.fn), /could not be downloaded/);
  assert.equal(plain.calls.length, 2);
});
