#!/usr/bin/env node
// Validates every devices/*/device.json against schemas/device.schema.json and
// writes public/data/devices.index.json, the summary list the app loads.
// Usage: node tools/build-device-index.mjs [--check]   (--check: validate only)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas/device.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const checkOnly = process.argv.includes('--check');

const errors = [];
const index = [];
const seenIds = new Map();
for (const dir of readdirSync(join(root, 'devices'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = join(root, 'devices', dir.name, 'device.json');
  if (!existsSync(file)) continue;
  let device;
  try {
    device = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${dir.name}: invalid JSON: ${e.message}`);
    continue;
  }
  if (!validate(device)) {
    for (const err of validate.errors) errors.push(`${dir.name}${err.instancePath}: ${err.message}`);
    continue;
  }
  if (device.id !== dir.name) errors.push(`${dir.name}: id "${device.id}" must match its folder name`);
  device.images.forEach((img, i) => {
    if (!existsSync(join(root, 'devices', dir.name, img.file))) errors.push(`${dir.name}: images[${i}] ${img.file} not found`);
  });
  device.controls.forEach((c, i) => {
    if (c.image !== undefined && c.image >= device.images.length) errors.push(`${dir.name}: controls[${i}] refers to missing image ${c.image}`);
  });
  for (const id of device.ids) {
    const k = `${id.bindsId}::${id.deviceIndex ?? '*'}`;
    if (seenIds.has(k) && device.source === 'user') errors.push(`${dir.name}: ${k} is already handled by ${seenIds.get(k)}`);
    if (!seenIds.has(k)) seenIds.set(k, dir.name);
  }
  index.push({
    id: device.id,
    name: device.name,
    source: device.source,
    ids: device.ids,
    ...(device.keyBindsIds ? { keyBindsIds: device.keyBindsIds } : {}),
    images: device.images,
    controlCount: device.controls.length,
  });
}

if (errors.length) {
  console.error(`device validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
index.sort((a, b) => a.name.localeCompare(b.name));
if (!checkOnly) {
  writeFileSync(join(root, 'public/data/devices.index.json'), JSON.stringify(index) + '\n');
}
console.log(`${index.length} devices ok${checkOnly ? '' : ' -> public/data/devices.index.json'}`);
