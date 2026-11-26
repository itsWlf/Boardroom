// Settings for downloading pictures of objects pasted from another whiteboard (whiteboard-api.ts).
// <WhiteboardApiHost /> is mounted once in board-chrome.tsx; `openWhiteboardApiSettings` shows the dialog.
import { useEffect, useState } from 'react';
import { isValidToken, loadWhiteboardApi, normalizeApiAddress, saveWhiteboardApi } from './whiteboard-api';

let open: ((done: (message: string) => void) => void) | null = null;
/** Show the settings dialog. `done` receives a short message when settings were saved or removed. */
export const openWhiteboardApiSettings = (done: (message: string) => void) => open?.(done);

export function WhiteboardApiHost() {
  const [done, setDone] = useState<((message: string) => void) | null>(null),
    [api, setApi] = useState(''),
    [token, setToken] = useState(''),
    [saved, setSaved] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    open = callback => {
      const current = loadWhiteboardApi();
      setApi(current?.api ?? '');
      setToken(current?.token ?? '');
      setSaved(!!current);
      setError('');
      setDone(() => callback);
    };
    return () => {
      open = null;
    };
  }, []);
  if (!done) return null;
  const close = (message?: string) => {
    if (message) done(message);
    setDone(null);
  };
  const save = () => {
    let address: string;
    try {
      address = normalizeApiAddress(api);
    } catch (e) {
      return setError((e as Error).message);
    }
    if (!isValidToken(token.trim())) return setError('Enter the access token (at least 8 characters, no spaces).');
    if (!saveWhiteboardApi({ api: address, token: token.trim() }))
      return setError('This browser could not store the settings.');
    close('Picture download is set up. Paste the objects again to download their pictures.');
  };
  return (
    <div className="format-overlay" onKeyDown={e => e.stopPropagation()}>
      <form
        className="format-dialog floating passphrase-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Picture download"
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2>Picture download</h2>
        <p>
          Objects pasted from another whiteboard arrive without their picture files. With that whiteboard&apos;s API
          address and an access token that may read your boards, Boardroom downloads the pictures when you paste and
          stores them with this board.
        </p>
        <p>
          The token is kept in this browser only and is sent only to the address below. Without these settings Boardroom
          contacts no other service when you paste.
        </p>
        <label>
          API address
          <input
            type="url"
            autoFocus
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            value={api}
            onChange={e => setApi(e.target.value)}
          />
        </label>
        <label>
          Access token
          <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
        </label>
        {error && (
          <p className="format-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {saved && (
            <button
              type="button"
              onClick={() =>
                saveWhiteboardApi(null)
                  ? close('Picture download is turned off and the token is removed.')
                  : setError('This browser could not remove the settings.')
              }
            >
              Remove token
            </button>
          )}
          <button type="button" onClick={() => close()}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}
