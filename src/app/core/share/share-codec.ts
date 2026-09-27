/**
 * Encodes a bindings file into a URL fragment and back, so a file can be
 * shared as a link without any server storing it. The file is compressed
 * with deflate-raw and base64url-encoded.
 *
 * Fragment format: `#b=<data>&n=<file name>` (the fragment is never sent to a server).
 */

export interface SharedFile {
  name: string;
  text: string;
}

export async function encodeShare(file: SharedFile): Promise<string> {
  const bytes = await compress(new TextEncoder().encode(file.text));
  return `b=${toBase64Url(bytes)}&n=${encodeURIComponent(file.name)}`;
}

/** Parse a location hash (with or without '#'); null if it isn't a share link. */
export async function decodeShare(hash: string): Promise<SharedFile | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const data = params.get('b');
  if (!data) return null;
  const bytes = await decompress(fromBase64Url(data));
  return { name: params.get('n') || 'Shared.binds', text: new TextDecoder().decode(bytes) };
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('deflate-raw'));
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('deflate-raw'));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const out = source.pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
