/**
 * A minimal, lossless XML tree for `.binds` files.
 *
 * Every byte of the source is kept: text between tags (whitespace, comments,
 * the `<?xml ?>` declaration) is stored raw, and each start tag keeps its raw
 * text until it is edited. Serialising an unedited tree returns the input
 * unchanged. Edits regenerate only the tags they touch, in the game's style.
 *
 * Supports the subset of XML that `.binds` files use: elements, attributes,
 * text, comments, processing instructions. No DTDs or CDATA.
 */

export interface XmlAttr {
  name: string;
  value: string;
  /** Whitespace before the attribute name. */
  pre: string;
  /** Raw text between the name and the opening quote, usually `=`. */
  eq: string;
  quote: '"' | "'";
}

export interface XmlText {
  type: 'text';
  raw: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: XmlAttr[];
  children: XmlNode[];
  selfClosing: boolean;
  parent: XmlElement | null;
  /** Original start tag, or null once edited (then it is regenerated). */
  openRaw: string | null;
  /** Raw whitespace between the last attribute and `>` / `/>`. */
  openTail: string;
  /** Raw end tag, e.g. `</Primary>`; empty for self-closing elements. */
  closeRaw: string;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlDocument {
  /** Nodes before, around and after the root element. */
  nodes: XmlNode[];
  root: XmlElement;
  bom: boolean;
  newline: '\n' | '\r\n';
  indent: string;
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'XmlParseError';
  }
}

const ATTR_RE = /(\s+)([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/y;
const NAME_RE = /[A-Za-z_][\w.:-]*/y;

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
        );
    }
  });
}

export function encodeAttr(s: string, quote: '"' | "'"): string {
  const out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&apos;');
}

export function encodeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

export function parseXml(input: string): XmlDocument {
  const bom = input.charCodeAt(0) === 0xfeff;
  const src = bom ? input.slice(1) : input;
  const fail = (msg: string, at: number): never => {
    throw new XmlParseError(msg, at, lineAt(src, at));
  };

  const top: XmlNode[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  const pushNode = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) {
      if (node.type === 'element') node.parent = parent;
      parent.children.push(node);
    } else {
      top.push(node);
    }
  };
  const pushText = (raw: string) => {
    if (!raw) return;
    const siblings = stack.length ? stack[stack.length - 1].children : top;
    const last = siblings[siblings.length - 1];
    if (last && last.type === 'text') last.raw += raw;
    else pushNode({ type: 'text', raw });
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) fail('Unterminated comment', i);
      pushText(src.slice(i, end + 3));
      i = end + 3;
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end === -1) fail('Unterminated processing instruction', i);
      pushText(src.slice(i, end + 2));
      i = end + 2;
    } else if (src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      if (end === -1) fail('Unterminated declaration', i);
      pushText(src.slice(i, end + 1));
      i = end + 1;
    } else if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      if (end === -1) fail('Unterminated end tag', i);
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        fail(`Unexpected </${name}>${open ? `, expected </${open.name}>` : ''}`, i);
      }
      open!.closeRaw = src.slice(i, end + 1);
      i = end + 1;
    } else {
      const start = i;
      NAME_RE.lastIndex = i + 1;
      const nm = NAME_RE.exec(src);
      if (!nm) fail('Invalid tag name', i);
      const el: XmlElement = {
        type: 'element',
        name: nm![0],
        attrs: [],
        children: [],
        selfClosing: false,
        parent: null,
        openRaw: null,
        openTail: '',
        closeRaw: '',
      };
      i = NAME_RE.lastIndex;
      for (;;) {
        ATTR_RE.lastIndex = i;
        const m = ATTR_RE.exec(src);
        if (!m) break;
        const quote = m[4] !== undefined ? '"' : "'";
        el.attrs.push({
          pre: m[1],
          name: m[2],
          eq: m[3],
          quote,
          value: decodeEntities(m[4] ?? m[5]),
        });
        i = ATTR_RE.lastIndex;
      }
      const tailMatch = /^(\s*)(\/?)>/.exec(src.slice(i, i + 64));
      if (!tailMatch) fail(`Malformed start tag <${el.name}>`, start);
      el.openTail = tailMatch![1];
      el.selfClosing = tailMatch![2] === '/';
      i += tailMatch![0].length;
      el.openRaw = src.slice(start, i);

      if (!stack.length) {
        if (root) fail('Multiple root elements', start);
        root = el;
      }
      pushNode(el);
      if (!el.selfClosing) stack.push(el);
    }
  }
  if (stack.length) fail(`Unclosed <${stack[stack.length - 1].name}>`, src.length);
  if (!root) fail('No root element', 0);

  return {
    nodes: top,
    root: root!,
    bom,
    newline: src.includes('\r\n') ? '\r\n' : '\n',
    indent: detectIndent(root!),
  };
}

function detectIndent(root: XmlElement): string {
  for (const n of root.children) {
    if (n.type === 'text') {
      const m = /\n([ \t]+)$/.exec(n.raw);
      if (m) return m[1];
    }
  }
  return '\t';
}

export function serializeXml(doc: XmlDocument): string {
  const out: string[] = [];
  if (doc.bom) out.push('﻿');
  const write = (node: XmlNode) => {
    if (node.type === 'text') {
      out.push(node.raw);
      return;
    }
    out.push(node.openRaw ?? renderOpenTag(node));
    if (node.selfClosing) return;
    for (const c of node.children) write(c);
    out.push(node.closeRaw || `</${node.name}>`);
  };
  for (const n of doc.nodes) write(n);
  return out.join('');
}

export function renderOpenTag(el: XmlElement): string {
  const attrs = el.attrs
    .map((a) => `${a.pre || ' '}${a.name}${a.eq || '='}${a.quote}${encodeAttr(a.value, a.quote)}${a.quote}`)
    .join('');
  return `<${el.name}${attrs}${el.openTail}${el.selfClosing ? '/>' : '>'}`;
}

// ------------------------------------------------------------------ queries

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter(
    (c): c is XmlElement => c.type === 'element' && (name === undefined || c.name === name),
  );
}

export function childElement(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.type === 'element' && c.name === name);
}

export function getAttr(el: XmlElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

// ------------------------------------------------------------------ edits

/** Set (or add, after `after` if given) an attribute. Returns true if changed. */
export function setAttr(el: XmlElement, name: string, value: string, after?: string): boolean {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) {
    if (existing.value === value) return false;
    existing.value = value;
  } else {
    const attr: XmlAttr = { name, value, pre: ' ', eq: '=', quote: '"' };
    const idx = after ? el.attrs.findIndex((a) => a.name === after) : -1;
    if (idx >= 0) el.attrs.splice(idx + 1, 0, attr);
    else el.attrs.push(attr);
  }
  el.openRaw = null;
  return true;
}

export function removeAttr(el: XmlElement, name: string): boolean {
  const idx = el.attrs.findIndex((a) => a.name === name);
  if (idx < 0) return false;
  el.attrs.splice(idx, 1);
  el.openRaw = null;
  return true;
}

/** Indentation string of an element, taken from the whitespace before it. */
export function indentOf(el: XmlElement, doc: XmlDocument): string {
  const siblings = el.parent ? el.parent.children : doc.nodes;
  const idx = siblings.indexOf(el);
  const prev = siblings[idx - 1];
  if (prev && prev.type === 'text') {
    const m = /(?:^|\n)([ \t]*)$/.exec(prev.raw);
    if (m) return m[1];
  }
  let depth = 0;
  for (let p = el.parent; p; p = p.parent) depth++;
  return doc.indent.repeat(depth);
}

export function createElement(name: string, attrs: Record<string, string> = {}): XmlElement {
  return {
    type: 'element',
    name,
    attrs: Object.entries(attrs).map(([n, v]) => ({ name: n, value: v, pre: ' ', eq: '=', quote: '"' })),
    children: [],
    selfClosing: true,
    parent: null,
    openRaw: null,
    openTail: ' ',
    closeRaw: '',
  };
}

/**
 * Insert `child` into `parent` at element position `index` (counting element
 * children only; default: append), with indentation matching the document.
 */
export function insertChild(doc: XmlDocument, parent: XmlElement, child: XmlElement, index?: number): void {
  const nl = doc.newline;
  const parentIndent = indentOf(parent, doc);
  const childIndent = parentIndent + doc.indent;
  child.parent = parent;

  if (parent.selfClosing || !childElements(parent).length) {
    // Turn <X ... /> into <X ...>\n\t<child />\n</X>, as the game writes it.
    parent.selfClosing = false;
    parent.openTail = '';
    parent.openRaw = null;
    parent.closeRaw = `</${parent.name}>`;
    parent.children = [{ type: 'text', raw: nl + childIndent }, child, { type: 'text', raw: nl + parentIndent }];
    return;
  }

  const elements = childElements(parent);
  const ref = index === undefined || index >= elements.length ? null : elements[index];
  if (ref) {
    const at = parent.children.indexOf(ref);
    parent.children.splice(at, 0, child, { type: 'text', raw: nl + childIndent });
  } else {
    const last = elements[elements.length - 1];
    const at = parent.children.indexOf(last) + 1;
    parent.children.splice(at, 0, { type: 'text', raw: nl + childIndent }, child);
  }
}

/** Remove an element and the whitespace that introduced it. */
export function removeChild(child: XmlElement): void {
  const parent = child.parent;
  if (!parent) return;
  const at = parent.children.indexOf(child);
  if (at < 0) return;
  const prev = parent.children[at - 1];
  const start = prev && prev.type === 'text' && /^\s*$/.test(prev.raw) ? at - 1 : at;
  parent.children.splice(start, at - start + 1);
  child.parent = null;

  if (!childElements(parent).length) {
    // Collapse back to the self-closing form: <X ... />
    parent.children = [];
    parent.selfClosing = true;
    parent.openTail = ' ';
    parent.openRaw = null;
    parent.closeRaw = '';
  }
}
