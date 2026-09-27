#!/usr/bin/env python3
"""Import device layouts, action metadata and templates from upstream projects.

Run tools/fetch-upstream.sh first. Writes:
  devices/<Id>/device.json (+ artwork)   one folder per supported device
  public/data/actions.json               action catalogue
  public/data/device-ids.json            named Elite device IDs -> USB VID/PID
  public/data/keys.json                  Elite keyboard key names -> labels
  public/data/templates/Empty.4.2.binds  every action, nothing bound

Existing device folders with "source": "user" are never overwritten.
Requires Python 3.9+ and ImageMagick (`convert`) for the artwork.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UP = ROOT / 'upstream'
ERC = UP / 'edrefcard2'
ERC_SCRIPTS = ERC / 'www' / 'scripts'
EDCD_MAPS = next((UP / 'EliteCustomButtonNames' / 'files').glob('*/DeviceButtonMaps'))
DEVICES = ROOT / 'devices'
DATA = ROOT / 'public' / 'data'

HEX_ID = re.compile(r'^[0-9A-Fa-f]{8}$')


def load_json(path):
    """json.loads that tolerates the trailing commas some upstream files have."""
    return json.loads(re.sub(r',\s*([\]}])', r'\1', path.read_text(encoding='utf-8-sig')))


def load_py(path):
    ns = {}
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), ns)
    return ns


def humanize(code):
    """FSSDiscoveryScan -> 'FSS Discovery Scan'; UI_Up -> 'UI Up'."""
    s = code.replace('_', ' ')
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s)
    s = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def control_kind(key, erc_type=None):
    if 'POV' in key:
        return 'hat'
    if key.endswith('Axis') or key.startswith(('Pos_', 'Neg_')) or 'Slider' in key or erc_type == 'Analogue':
        return 'axis'
    return 'button'


# ---------------------------------------------------------------- labels

def parse_button_map(path):
    text = path.read_text(encoding='utf-8-sig')
    header = re.search(r'<!--\s*(.*?)\s*-->\s*<Root', text, re.S)
    labels = dict(re.findall(r'<([A-Za-z0-9_]+)>([^<]*)</\1>', text))
    return (header.group(1).strip() if header else None), {k: v.strip() for k, v in labels.items()}


def edcd_maps():
    maps = {}
    for f in sorted(EDCD_MAPS.glob('*.buttonMap')):
        maps[f.stem] = parse_button_map(f)
    return maps


def edbindings_labels():
    """EdBindings DeviceMappings: {bindsId: {key: label}}."""
    out = {}
    for f in (UP / 'EdBindings' / 'src' / 'EdBindings' / 'DeviceMappings').glob('*.json'):
        for c in load_json(f)['controls']:
            out.setdefault(c['deviceId'], {})[c['controlValue']] = c['controlLabel']
    return out


def erc_comment_labels():
    """Pull the trailing '# comment' on each hotasDetails line as a label."""
    labels, current = {}, None
    in_details = False
    for line in (ERC_SCRIPTS / 'bindingsData.py').read_text(encoding='utf-8').splitlines():
        if line.startswith('hotasDetails'):
            in_details = True
            continue
        if not in_details:
            continue
        m = re.match(r"^\s*'([^']+)':\s*\{\s*(#.*)?$", line)
        if m:
            current = m.group(1)
            continue
        m = re.match(r"^\s*'([^']+)':\s*\{'Type'.*\}\s*,?\s*#\s*(.+?)\s*$", line)
        if m and current:
            labels.setdefault(current, {})[m.group(1)] = m.group(2)
        if line.startswith('}'):
            break
    return labels


# ---------------------------------------------------------------- devices

DEVICE_NAMES = {
    'CHCombatStick': 'CH Combatstick + Pro Throttle', 'CHFighterStick': 'CH Fighterstick + Pro Throttle',
    'CHProFlightThrottleQuadrant': 'CH Pro Flight Throttle Quadrant', 'CHProPedals': 'CH Pro Pedals',
    'CHProThrottle': 'CH Pro Throttle', 'CHThrottleQuadrant': 'CH Throttle Quadrant', 'CobraM5': 'Defender Cobra M5',
    'Cougar': 'Thrustmaster Cougar MFDs', 'DS4': 'Sony DualShock 4', 'GamePad': 'Xbox 360 / generic gamepad',
    'Gladiator': 'VKB Gladiator', 'HotasCougar': 'Thrustmaster HOTAS Cougar',
    'Logitech710WirelessGamepad': 'Logitech F710 Wireless Gamepad', 'LogitechExtreme3DPro': 'Logitech Extreme 3D Pro',
    'LogitechG940': 'Logitech G940 Stick + Throttle', 'LogitechG940Pedals': 'Logitech G940 Pedals',
    'LogitechGTWheel': 'Logitech Driving Force GT Wheel', 'MFGCrosswind': 'MFG Crosswind Pedals',
    'Sabretooth': 'Razer Sabertooth', 'SaitekFLY5': 'Saitek Cyborg FLY 5',
    'SaitekProFlightCombatPedals': 'Saitek Pro Flight Combat Pedals', 'SaitekProFlightPedals': 'Saitek Pro Flight Pedals',
    'SaitekX45': 'Saitek X45', 'SaitekX52': 'Saitek X52', 'SaitekX52Pro': 'Saitek X52 Pro', 'SaitekX55': 'Saitek X55',
    'SaitekX56': 'Logitech/Saitek X56', 'SidePanelControlDeck': 'Saitek Side Panel Control Deck',
    'SlawBF109Pedals': 'Slaw BF-109 Pedals', 'T-Rudder': 'Thrustmaster TFRP Pedals', 'T16000M': 'Thrustmaster T.16000M',
    'T16000MFCS': 'Thrustmaster T.16000M FCS HOTAS', 'TCASidestickLeft': 'Thrustmaster TCA Sidestick (Left)',
    'TCASidestickRight': 'Thrustmaster TCA Sidestick (Right)', 'TFlightHOTASX': 'Thrustmaster T.Flight HOTAS X',
    'TFlightStickX': 'Thrustmaster T.Flight Stick X', 'TPR-Rudder': 'Thrustmaster TPR Pedals',
    'ThrustMasterHOTAS4': 'Thrustmaster T.Flight HOTAS 4 / One', 'VKB-GNX-WWII-Throttle': 'VKB Gladiator NXT WWII Throttle',
    'VKB-Gladiator-NXT-Premium-Left': 'VKB Gladiator NXT Premium (Left)',
    'VKB-Gladiator-NXT-Premium-Left-OTA': 'VKB Gladiator NXT Premium OTA (Left)',
    'VKB-Gladiator-NXT-Premium-Right': 'VKB Gladiator NXT Premium (Right)',
    'VKB-Gladiator-NXT-Premium-Right-OTA': 'VKB Gladiator NXT Premium OTA (Right)',
    'VKB-Kosmosima-SCG-Left': 'VKB Kosmosima SCG (Left)', 'VKB-Kosmosima-SCG-Right': 'VKB Kosmosima SCG (Right)',
    'VKB-STECS-VC1': 'VKB STECS (virtual controller 1)', 'VKB-STECS-VC2': 'VKB STECS (virtual controller 2)',
    'VPC-ALPHA-Left': 'Virpil Alpha (Left)', 'VPC-ALPHA-Left-Custom': 'Virpil Alpha (Left, custom)',
    'VPC-ALPHA-Prime-Left': 'Virpil Alpha Prime (Left)', 'VPC-ALPHA-Prime-Right': 'Virpil Alpha Prime (Right)',
    'VPC-ALPHA-Right': 'Virpil Alpha (Right)', 'VPC-ALPHA-Right-Custom': 'Virpil Alpha (Right, custom)',
    'VPC-Control-Panel-2': 'Virpil Control Panel #2', 'VPC-FLNKR-Right': 'Virpil Constellation FLNKR (Right)',
    'VPC-MongoosT-50CM2-Throttle': 'Virpil MongoosT-50CM2 Throttle',
    'VPC-MongoosT-50CM3-Throttle': 'Virpil MongoosT-50CM3 Throttle',
    'VPC-MongoosT-50CM3-Throttle-32B': 'Virpil MongoosT-50CM3 Throttle (32-button mode)',
    'VPC-MongoosT-50CM3-Throttle-32B-No-Shift': 'Virpil MongoosT-50CM3 Throttle (32-button, no shift)',
    'VPC-WarBRD-DELTA-Left': 'Virpil WarBRD DELTA (Left)', 'VPC-WarBRD-DELTA-Right': 'Virpil WarBRD DELTA (Right)',
    'Warthog': 'Thrustmaster HOTAS Warthog', 'Winwing-Orion-Throttle-2-F18-Handle': 'WinWing Orion 2 Throttle (F/A-18 handle)',
    'Winwing-Ursa-Minor-Fighter-Left': 'WinWing Ursa Minor Fighter (Left)',
    'Winwing-Ursa-Minor-Fighter-Right': 'WinWing Ursa Minor Fighter (Right)',
    'XBox': 'Xbox One controller', 'XBoxElite': 'Xbox One Elite controller',
}


def device_name(key):
    if key in DEVICE_NAMES:
        return DEVICE_NAMES[key]
    s = key.replace('-', ' ')
    s = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', s)
    s = re.sub(r'(?<=[0-9])(?=[A-Z][a-z])', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    fixes = {'Thrust Master': 'Thrustmaster', 'Saitek X': 'Saitek X', 'Logitech Extreme3D Pro': 'Logitech Extreme 3D Pro',
             'T16000MFCS': 'T.16000M FCS', 'T16000M': 'T.16000M', 'CH ': 'CH ', 'VPC ': 'Virpil ', 'VKB ': 'VKB '}
    for a, b in fixes.items():
        s = s.replace(a, b)
    return s


def split_handled(handled):
    """'231D012D::0' -> ('231D012D', 0); 'X' -> ('X', None)."""
    if '::' in handled:
        dev, idx = handled.split('::', 1)
        return dev, int(idx)
    return handled, None


def usb_of(binds_id, named_ids):
    if HEX_ID.match(binds_id):
        return {'vid': binds_id[:4].upper(), 'pid': binds_id[4:].upper()}
    ids = named_ids.get(binds_id)
    return dict(ids[0]) if ids else None


def convert_image(template, dest_dir):
    src = ERC / 'www' / 'res' / f'{template}.jpg'
    if not src.exists():
        return None
    out = dest_dir / f'{template}.webp'
    if not out.exists():
        subprocess.run(['convert', str(src), '-strip', '-quality', '80', str(out)], check=True)
    size = subprocess.run(['identify', '-format', '%w %h', str(out)], check=True,
                          capture_output=True, text=True).stdout.split()
    return {'file': out.name, 'width': int(size[0]), 'height': int(size[1])}


def import_devices(named_ids, actions_by_code):
    bd = load_py(ERC_SCRIPTS / 'bindingsData.py')
    supported, details, hotas_map = bd['supportedDevices'], bd['hotasDetails'], bd['hotasMap']
    comments = erc_comment_labels()
    edcd = edcd_maps()
    edb = edbindings_labels()
    covered_binds_ids = set()
    written = []

    def label_for(binds_id, key):
        for source in (edcd.get(binds_id, (None, {}))[1], edb.get(binds_id, {}), comments.get(binds_id, {})):
            if key in source and source[key]:
                return source[key]
        return None

    for key, spec in supported.items():
        if key == 'Keyboard':
            continue  # rendered from keys.json, not artwork
        dest = DEVICES / key
        existing = dest / 'device.json'
        if existing.exists() and json.loads(existing.read_text()).get('source') == 'user':
            continue
        dest.mkdir(parents=True, exist_ok=True)
        image = convert_image(spec['Template'], dest)
        handled = spec['HandledDevices']
        controls = []
        for h in handled:
            dev, idx = split_handled(h)
            detail = details.get(h) or details.get(dev) or details.get(hotas_map.get(dev, ''))
            if not detail:
                continue
            for ckey, box in detail.items():
                if ckey == 'displayName' or not isinstance(box, dict):
                    continue
                c = {'bindsId': dev}
                if idx is not None:
                    c['deviceIndex'] = idx
                c.update({
                    'key': ckey,
                    'label': label_for(dev, ckey) or humanize(ckey.replace('Joy_', '')),
                    'kind': control_kind(ckey, box.get('Type')),
                })
                if image:  # a few upstream devices have coordinates but no artwork
                    c['image'] = 0
                    c['box'] = {'x': box['x'], 'y': box['y'], 'w': box['width'], 'h': box.get('height', 54)}
                controls.append(c)
        ids = []
        for h in handled:
            dev, idx = split_handled(h)
            entry = {'bindsId': dev}
            if idx is not None:
                entry['deviceIndex'] = idx
            usb = usb_of(dev, named_ids)
            if usb:
                entry['usb'] = usb
            ids.append(entry)
            covered_binds_ids.add(dev)
        device = {
            '$schema': '../../schemas/device.schema.json',
            'id': key,
            'name': device_name(key),
            'source': 'edrefcard2',
            'ids': ids,
        }
        if 'KeyDevices' in spec:
            device['keyBindsIds'] = spec['KeyDevices']
        device['images'] = [image] if image else []
        device['controls'] = controls
        existing.write_text(json.dumps(device, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        written.append(key)

    # Devices only known from EDCD button maps: labels + inventory, no artwork.
    for binds_id, (header, labels) in edcd.items():
        if binds_id == 'Generic' or binds_id in covered_binds_ids:
            continue
        key = f'EDCD-{binds_id}'
        dest = DEVICES / key
        existing = dest / 'device.json'
        if existing.exists() and json.loads(existing.read_text()).get('source') == 'user':
            continue
        dest.mkdir(parents=True, exist_ok=True)
        name = (header or binds_id).splitlines()[0].strip()
        entry = {'bindsId': binds_id}
        usb = usb_of(binds_id, named_ids)
        if usb:
            entry['usb'] = usb
        device = {
            '$schema': '../../schemas/device.schema.json',
            'id': key,
            'name': name,
            'source': 'edcd',
            'ids': [entry],
            'images': [],
            'controls': [{'bindsId': binds_id, 'key': k, 'label': v, 'kind': control_kind(k)}
                         for k, v in labels.items()],
        }
        existing.write_text(json.dumps(device, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        written.append(key)

    # Generic fallback inventory for unknown hardware.
    _, generic = edcd['Generic']
    (DATA / 'generic-device.json').write_text(json.dumps(
        [{'key': k, 'label': v, 'kind': control_kind(k)} for k, v in generic.items()], indent=2) + '\n')
    return written


# ---------------------------------------------------------------- IDs

def import_named_ids():
    """Named Elite device IDs -> USB VID/PID (facts from the game's DeviceMappings.xml)."""
    xml = (ERC / 'bindings' / 'Defaults ODY patch 8' / 'DeviceMappings.xml').read_text(encoding='utf-8-sig')
    xml = re.sub(r'<!--.*?-->', '', xml, flags=re.S)
    xml = re.sub(r'</?Root>', '', xml)
    out = {}
    for m in re.finditer(r'<([A-Za-z][A-Za-z0-9_-]*)>(.*?)</\1>', xml, re.S):
        name, body = m.group(1), m.group(2)
        if name in ('Root', 'Alternative'):
            continue
        pairs = re.findall(r'<PID>\s*([0-9A-Fa-f]{4})\s*</PID>\s*<VID>\s*([0-9A-Fa-f]{4})\s*</VID>', body)
        if pairs:
            out[name] = [{'vid': v.upper(), 'pid': p.upper()} for p, v in pairs]
    return out


# ---------------------------------------------------------------- actions

def import_actions(template_codes):
    cd = load_py(ERC_SCRIPTS / 'controlsData.py')['controls']
    edbv = load_json(UP / 'EDBV' / 'mappings.edbv')
    edb = load_json(UP / 'EdBindings' / 'src' / 'EdBindings' / 'ActionMappings.json')
    short = load_json(UP / 'EliteBinding' / 'Meancat.EliteBinding.Tests' / 'naming.json')

    taxonomy = {}
    for row in edb + edbv:  # EDBV (newer) wins
        taxonomy[row['code']] = {k: row[k].strip() for k in ('area', 'category', 'action')}

    codes = list(dict.fromkeys(list(template_codes) + list(cd) + list(taxonomy)))
    actions = []
    for order, code in enumerate(codes):
        erc = cd.get(code, {})
        tax = taxonomy.get(code, {})
        entry = {
            'code': code,
            'name': erc.get('Name') or tax.get('action') or humanize(code),
            'longName': tax.get('action') or erc.get('Name') or humanize(code),
            'group': erc.get('Group', 'Misc'),
            'category': erc.get('Category', 'General'),
            'area': tax.get('area') or 'Other',
            'section': tax.get('category') or erc.get('Group', 'Misc'),
            'type': 'analogue' if erc.get('Type') == 'Analogue' else ('digital' if erc else None),
            'order': order,
        }
        if erc.get('HasAnalogue'):
            entry['hasAnalogue'] = True
        if erc.get('HideIfSameAs'):
            entry['hideIfSameAs'] = erc['HideIfSameAs']
        if code in short:
            entry['short'] = short[code]
        if code not in template_codes:
            entry['legacy'] = True
        actions.append(entry)
    return actions


# ---------------------------------------------------------------- template

def make_empty_template():
    """Blank a real 4.2 file in place, preserving the game's own formatting."""
    src = UP / 'EliteBinding' / 'Meancat.EliteBinding.Tests' / 'Custom.4.2.binds'
    raw = src.read_bytes()
    text = raw.decode('utf-8-sig')
    text = re.sub(r'(<(?:Primary|Secondary|Binding)) Device="[^"]*"( DeviceIndex="[^"]*")? Key="[^"]*"',
                  r'\1 Device="{NoDevice}" Key=""', text)
    # Drop modifiers: turn "<Primary ...>\n<Modifier/>\n</Primary>" back into "<Primary ... />".
    text = re.sub(r'(<(Primary|Secondary|Binding) [^>/]*?)\s*>\s*(?:<Modifier [^>]*/>\s*)+</\2>', r'\1 />', text)
    text = re.sub(r'<Inverted Value="1"', '<Inverted Value="0"', text)
    text = re.sub(r'<ToggleOn Value="1"', '<ToggleOn Value="0"', text)
    text = text.replace('PresetName="Custom"', 'PresetName="Empty"', 1)
    out = DATA / 'templates' / 'Empty.4.2.binds'
    out.parent.mkdir(parents=True, exist_ok=True)
    bom = b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b''
    out.write_bytes(bom + text.encode('utf-8'))
    shutil.copy(src, ROOT / 'src' / 'testing' / 'fixtures' / 'Custom.4.2.binds')
    codes = []
    depth = 0
    for m in re.finditer(r'<(/?)([A-Za-z0-9_]+)[^>]*?(/?)>', text):
        closing, name, selfclose = m.group(1), m.group(2), m.group(3)
        if closing:
            depth -= 1
            continue
        if depth == 1 and name not in ('KeyboardLayout',):
            codes.append(name)
        if not selfclose:
            depth += 1
    return codes, text


def binding_codes(text):
    """Root-level elements that contain Primary/Secondary/Binding."""
    return set(re.findall(r'<([A-Za-z0-9_]+)>\s*<(?:Primary|Binding) ', text))


# ---------------------------------------------------------------- keys

def import_keys():
    erc_map = load_py(ERC_SCRIPTS / 'bindingsData.py')['keymap']
    ts = (UP / 'EDRefKB' / 'keys.ts').read_text(encoding='utf-8')
    all_keys = re.findall(r'"(Key_[^"]+)"', re.search(r'type AllKeys=([^;]+);', ts).group(1))
    kb_labels = dict(re.findall(r'(Key_\w+):\s*new Button\("([^"]*)"', ts))
    keys = []
    for k in dict.fromkeys(all_keys + list(erc_map)):
        label = erc_map.get(k) or kb_labels.get(k) or k[4:].replace('_', ' ')
        keys.append({'key': k, 'label': label})
    return keys


def main():
    if not ERC.exists():
        sys.exit('upstream/ missing: run tools/fetch-upstream.sh first')
    DATA.mkdir(parents=True, exist_ok=True)
    (ROOT / 'src' / 'testing' / 'fixtures').mkdir(parents=True, exist_ok=True)
    DEVICES.mkdir(exist_ok=True)

    codes, template_text = make_empty_template()
    named_ids = import_named_ids()
    (DATA / 'device-ids.json').write_text(json.dumps(named_ids, indent=2) + '\n')

    actions = import_actions(codes)
    analogue = binding_codes(template_text)
    settings = []
    for a in actions:
        if a['type'] is None:
            a['type'] = 'analogue' if a['code'] in analogue else 'digital'
    action_codes = {a['code'] for a in actions}
    for code in codes:
        if not re.search(rf'<{code}>\s*<(Primary|Binding) ', template_text):
            settings.append(code)
    actions = [a for a in actions if a['code'] not in settings]
    (DATA / 'actions.json').write_text(json.dumps(actions, indent=1, ensure_ascii=False) + '\n')
    (DATA / 'settings.json').write_text(json.dumps(
        [{'code': c, 'name': humanize(c)} for c in settings], indent=1) + '\n')

    (DATA / 'keys.json').write_text(json.dumps(import_keys(), indent=1, ensure_ascii=False) + '\n')
    written = import_devices(named_ids, {a['code']: a for a in actions})

    print(f'actions: {len(actions)} ({len(action_codes & set(codes))} in template), settings: {len(settings)}')
    print(f'named device ids: {len(named_ids)}, devices written: {len(written)}')


if __name__ == '__main__':
    main()
