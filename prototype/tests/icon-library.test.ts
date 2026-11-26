// The icon tables: codes of the free "classic" icon font to Boardroom icons, the extra drawn icons, and search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icons } from 'lucide-react';
import { ICON_BY_CODE } from '../src/icon-codes.ts';
import { extraIcons, iconKeywords } from '../src/icon-extras.ts';
import { searchIcons } from '../src/icon-search.ts';
import { parseBoard, createItem } from '../src/model.ts';

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Names of the bundled set, compared without case or dashes (so a differently cased duplicate is caught too). */
const bundled = new Set(Object.keys(icons).map(flat));

test('every code points at an icon that exists, bundled or extra', () => {
  const unknown = Object.entries(ICON_BY_CODE).filter(([, name]) => !bundled.has(flat(name)) && !extraIcons[name]);
  assert.deepEqual(unknown, []);
  assert.ok(Object.keys(ICON_BY_CODE).every(code => /^[ef][0-9a-f]{3}$/.test(code)));
  // A few fixed points: a bundled match, an older code for the same icon, and an extra drawn icon.
  assert.equal(ICON_BY_CODE.f07c, 'FolderOpen');
  assert.equal(ICON_BY_CODE.f115, 'FolderOpen');
  assert.equal(ICON_BY_CODE.f015, 'House');
  assert.equal(ICON_BY_CODE.f6ed, 'Hippo');
  assert.ok(extraIcons.Hippo);
});

test('extra icons are valid objects, clash with no bundled name and stay inside the 24 grid', () => {
  const allowed: Record<string, string[]> = {
    path: ['d'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points'],
    polygon: ['points'],
  };
  const problems: string[] = [];
  for (const [name, nodes] of Object.entries(extraIcons)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || name.length > 60) problems.push(`${name}: not a valid icon name`);
    if (bundled.has(flat(name))) problems.push(`${name}: clashes with a bundled icon`);
    if (!nodes.length || nodes.length > 10) problems.push(`${name}: ${nodes.length} elements`);
    for (const [tag, attrs] of nodes) {
      if (!allowed[tag]) problems.push(`${name}: <${tag}>`);
      for (const [key, value] of Object.entries(attrs)) {
        if (!allowed[tag]?.includes(key)) problems.push(`${name}: ${tag} ${key}`);
        else if (key === 'd' ? !/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9\s,.-]*$/.test(value) : !/^[0-9\s,.-]+$/.test(value))
          problems.push(`${name}: ${tag} ${key} has unexpected characters`);
        else if (key !== 'd' && key !== 'points' && !(Number(value) >= -0.5 && Number(value) <= 24.5))
          problems.push(`${name}: ${key}=${value} is outside the grid`);
      }
    }
    // The Icon object accepts the name.
    parseBoard({ version: 1, title: 't', items: [{ ...createItem('icon', 0, 0), data: { name } }] });
  }
  assert.deepEqual(problems, []);
});

test('every extra icon has search words, and words only name icons that exist', () => {
  assert.deepEqual(
    Object.keys(extraIcons).filter(n => !iconKeywords[n]),
    [],
  );
  assert.deepEqual(
    Object.keys(iconKeywords).filter(n => !bundled.has(flat(n)) && !extraIcons[n]),
    [],
  );
});

test('icon search matches names and search words, names first', () => {
  const names = ['Folder', 'FolderOpen', 'Trash2', 'Save', 'Hippo', 'House'];
  const words = {
    FolderOpen: 'folder open directory',
    Trash2: 'trash delete garbage remove',
    Save: 'save floppy disk',
    Hippo: 'hippo animal hippopotamus',
    House: 'house home building',
  };
  assert.deepEqual(searchIcons(names, words, ''), names);
  // The whole query in the name: exact, then prefix; dashes and spaces are ignored.
  assert.deepEqual(searchIcons(names, words, 'folder'), ['Folder', 'FolderOpen']);
  assert.deepEqual(searchIcons(names, words, 'folder-open'), ['FolderOpen']);
  assert.deepEqual(searchIcons(names, words, 'Open Folder'), ['FolderOpen']);
  // Search words: other names for the same thing.
  assert.deepEqual(searchIcons(names, words, 'floppy'), ['Save']);
  assert.deepEqual(searchIcons(names, words, 'delete'), ['Trash2']);
  assert.deepEqual(searchIcons(names, words, 'home'), ['House']);
  assert.deepEqual(searchIcons(names, words, 'animal hippo'), ['Hippo']);
  assert.deepEqual(searchIcons(names, words, 'zebra'), []);
  // With the real tables: the other icon font's names find the icon.
  const all = Object.keys(iconKeywords);
  assert.ok(searchIcons(all, iconKeywords, 'magnifying glass').includes('Search'));
  assert.ok(searchIcons(all, iconKeywords, 'gear').includes('Settings'));
  assert.equal(searchIcons(all, iconKeywords, 'hippo')[0], 'Hippo');
});
