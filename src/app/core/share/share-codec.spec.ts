import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeShare, encodeShare, fromBase64Url, toBase64Url } from './share-codec';

describe('share codec', () => {
  it('round-trips a real bindings file compactly', async () => {
    const text = readFileSync(resolve(process.cwd(), 'src/testing/fixtures/Custom.4.2.binds'), 'utf-8');
    const hash = await encodeShare({ name: 'My HOTAS.4.2.binds', text });
    expect(hash.length).toBeLessThan(text.length / 4);
    expect(hash).toMatch(/^b=[A-Za-z0-9_-]+&n=My%20HOTAS\.4\.2\.binds$/);
    expect(await decodeShare('#' + hash)).toEqual({ name: 'My HOTAS.4.2.binds', text });
  });

  it('returns null for other fragments', async () => {
    expect(await decodeShare('#section-2')).toBeNull();
    expect(await decodeShare('')).toBeNull();
  });

  it('base64url round-trips all byte values', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const s = toBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(fromBase64Url(s)).toEqual(bytes);
  });
});
