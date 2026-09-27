# Prior art

Research notes on existing open-source Elite Dangerous binding tools: what this project reuses from each, and which mistakes to avoid. Only projects with licences compatible with ours (MIT or Unlicense) are listed. GPL projects ([EDFM Cockpit Controls](https://github.com/ZaviiNet/EDFM-Cockpit-Controls), [joystick-diagrams](https://github.com/Rexeh/joystick-diagrams)) and unlicensed repositories were not used.

## Summary

| Project | Licence | Kind | What we take |
| --- | --- | --- | --- |
| [EDRefCard 2](https://github.com/brammmers/edrefcard2) | MIT | Python web app, reference cards | Device templates (68), control positions on the artwork (`hotasDetails`), 423 control definitions with group, category, type and redundancy rules, 3840×2160 artwork and SVG source files |
| [EDRefCard](https://github.com/richardbuckle/EDRefCard) | MIT | The original that edrefcard2 forked | Nothing extra: edrefcard2 contains everything it has |
| [EdBindings](https://github.com/ghorsey/EdBindings) | MIT | WPF table viewer | Table design, action → area/category/name mapping, device-label mapping format, bindED variable names |
| [EliteCustomButtonNames](https://github.com/EDCD/EliteCustomButtonNames) | MIT | Data | 38 `.buttonMap` label files, plus `Generic.buttonMap` as the fallback for unknown devices |
| [Bindwing](https://github.com/derrickmehaffy/bindwing) | MIT | Browser HOTAS editor | Live input design (WebHID with Gamepad fallback), hat and axis detection rules, click-to-bind on artwork, input debug view |
| [bindsmith](https://github.com/bullwinkle3000/bindsmith) | MIT | Python engine + web editor | Blank 4.2 action template (422 actions, 91 settings), moving a layout to a new device ID, audit ideas |
| [elite-dangerous-binds-editor](https://github.com/mholtmanns/elite-dangerous-binds-editor) | Unlicense | Tk desktop editor | Undo/redo command stack, timestamped `.bak` before saving, `<Name>.<Major>.<Minor>.binds` preset picker, readable fallback names made by splitting CamelCase action codes |
| [EDBV](https://github.com/DRA6N/EDBV) | MIT | PyQt viewer | `mappings.edbv`: 382 `{code, area, category, action}` rows. Trim the values: three have a trailing space |
| [EliteBinding](https://github.com/trasa/EliteBinding) | MIT | C# reader library | `naming.json` (37 short labels, e.g. `HyperSuperCombination` → "FSD"); `Custom.4.2.binds` as a test file |
| [EDRefKB](https://github.com/RealOfficialTurf/EDRefKB) | MIT | TypeScript keyboard sheet | List of about 164 `Key_*` names (including ä/ö/ü/ß, ABNT, Yen, Kana) and a table of about 333 action labels |

## Live input: lessons from Bindwing

Bindwing shows that capturing input in the browser works, and also where it goes wrong.

- **WebHID**: `device.collections[].inputReports[].items` exposes the parsed report descriptor. There is no need to parse raw descriptor bytes.
  - Walk the items with a running bit offset for each report ID.
  - Usage page 0x09 is buttons. Usage page 0x01 contains the axes: 0x30–0x35 are X/Y/Z/Rx/Ry/Rz, 0x36 (Slider) is `U`, 0x37 (Dial) is `V`, and 0x39 is a hat.
  - Bindwing numbers buttons with a running counter. **We should use the HID usage ID instead**, because it is what DirectInput, and so the game, uses for `Joy_N`.
  - Bindwing only asks for VKB devices (`vendorId: 0x231D`) and always names hats `POV1`. **We should ask for all devices** (with filters on joystick/gamepad usage pages) **and number hats by their order.**
- **Gamepad API**:
  - Chromium's `gamepad.id` contains `Vendor: xxxx Product: yyyy`. Firefox uses `xxxx-yyyy-name`. Handle both.
  - Chrome reports a hat as an axis with a neutral value of about 1.286. Treat any axis that goes above 1.1 as a hat and decode its 8 directions with `round((v + 1) * 3.5)`.
  - Devices with more than 32 buttons show up as several gamepads. Their order is not stable, so button offsets across them have to be confirmed by the user.
  - The browser allows at most 4 gamepads and stops sending input when the tab loses focus.
- **Axis detection**: record a resting value when capture starts. About 0.35 of movement means "this axis", and about 0.55 is used to switch the active device automatically.
- **Device IDs, a gap in Bindwing**: it only produces 8-digit hex IDs. Some devices are written by the game under named IDs (`SaitekX56Joystick`, `T16000M`, …), so live input silently fails to match those files. We need a VID/PID → named-ID table (EDRefCard's `HandledDevices` and the EDCD file names give part of it), and we should prefer whatever ID the loaded file already uses for that device.
- **Keyboard**: Bindwing has no keyboard capture. We need our own `KeyboardEvent.code` → `Key_*` table, starting from EDRefKB's key list.

## `.binds` format facts

- The header is `<?xml version="1.0" encoding="UTF-8" ?>`, with a space before `?>`. Indentation is tabs. Numbers have 8 decimal places (`0.09000000`).
- The root element is `<Root PresetName="…" MajorVersion="4" MinorVersion="2">`. It is followed by `<KeyboardLayout>` and then a mix of settings (`<X Value="…"/>`) and actions.
- Button actions contain `Primary` and `Secondary` slots, each with an optional `<Modifier Device Key/>` child. They can also contain `<ToggleOn Value/>`, and a slot can have `<Hold Value="1"/>`.
- Axis actions contain `<Binding Device Key/>` and, next to it, `<Inverted Value/>` and `<Deadzone Value/>`.
- An unbound slot is `Device="{NoDevice}" Key=""`. A blank profile must still contain every action.
- Button numbers can come from vendor software (for example the VKB long-press `Joy_31`). They don't always match a physical switch.
- Custom button names go in `%LOCALAPPDATA%\Frontier Developments\Elite Dangerous\Options\Bindings\DeviceButtonMaps\<DeviceId>.buttonMap`. The game re-reads them when you open *Options › Controls*. Invalid XML makes the game ignore the file without any error.

## Bugs in other tools to avoid

- **Rewriting the file through a DOM serializer** (binds-editor, bindsmith). This changes the whitespace, the header, the order of settings, and `Value=""` → empty element, and it drops comments. Change attributes in place and keep the original text wherever possible.
- **Resetting `Inverted`/`Deadzone` to defaults on every axis rebind** (Bindwing).
- **Silently overwriting the Secondary slot** when Primary is already bound (Bindwing).
- **Writing `Device="Keyboard"` for every modifier** (binds-editor). This corrupts joystick-button modifiers.
- **No way to add a Secondary slot when the file doesn't have one** (binds-editor).
- **Matching `Device` on every descendant element** (EliteBinding). This counts `<Modifier>` elements as bindings.
- **Reading XML attributes by position** (EDRefKB).
- **Conflict checks that ignore context or modifiers** (bindsmith). They produce many false positives. Check conflicts per group (Ship/SRV/On Foot/…) and per set of modifiers, as Bindwing does.
- **Guessing POV/axis-half types from key-name suffixes** (bindsmith treats `Joy_POV1Up` and `Pos_Joy_XAxis` as buttons).

## Open licensing questions

- **Frontier's own files**: default presets and `DeviceMappings.xml` are in edrefcard2's repository, but they are Frontier's, so edrefcard2's MIT licence probably doesn't cover them. Options:
  - Read them from the user's own game install (via the File System Access API).
  - Or build the VID/PID ↔ named-ID table from MIT-licensed sources only.
- **Controller artwork**: EDRefCard ships its template JPGs and SVGs under its MIT licence. Bindwing notes that the licensing of third-party device art is unresolved. Keep attribution and replace any art whose origin is unclear.
