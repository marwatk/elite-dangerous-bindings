# Adding or fixing a device

Every controller the app knows about is one folder under `devices/`:

```
devices/
  VKB-Gladiator-NXT-Premium-Right/
    device.json      # IDs, controls, labels, box positions
    gnx-right.webp   # artwork (optional, one or more images)
```

The bindings table, live input, the reference cards and the device browser all
read the same file, so adding a folder is all it takes — no code changes. The
format is defined by [`schemas/device.schema.json`](../schemas/device.schema.json).

There are two ways to make one: with the **layout editor** in the app (recommended),
or **by hand**.

## With the layout editor

Open **Devices → Map a new controller** (`/devices/new`), or open an existing
device and choose **Edit layout** to fix it. The editor works with the mouse
alone; a connected controller makes some steps faster. Your work is autosaved in
the browser, so a refresh doesn't lose it.

1. **Image.** Drop or choose one or more images (PNG, JPG, WebP or SVG). Use
   **Rotate / crop** to turn the image in 90° steps, straighten it by up to ±10°
   and drag a crop rectangle. Images are re-encoded to WebP (quality 0.85) with the
   longest side at most 3840 px; an SVG stays an SVG unless you crop or rotate it.
2. **Identify.** Give the device a name; the folder id is derived from it
   (letters, digits and dashes — change it if you like). Then add the Elite device
   ID(s):
   - **Press a button to detect**: press any button on the controller and the
     editor reads its ID (and USB VID/PID) through WebHID or the Gamepad API.
   - **From your bindings file**: pick one of the IDs used in the open `.binds` file.
   - **Type it**: 8 hex digits (`231D0200` = VID `231D` + PID `0200`) or a name
     Elite uses, such as `SaitekX56Joystick`.

   Extra IDs are treated as other revisions of the same hardware and share its
   controls. For a multi-part device (a stick and a throttle on one card) set the
   second ID's **Controls** column to *Its own controls*. `Index` is Elite's
   `DeviceIndex`, only needed when two identical devices are plugged in.
3. **Controls.** Build the list of buttons, axes and hats: from the detected
   controller (button/axis/hat counts), by count, from an existing definition or
   EDCD button map for the same ID, from the generic template, by importing a
   `.buttonMap`, or by simply pressing controls (each press adds it). You can add
   (`Joy_33`, `Joy_POV2Up`, …) and remove controls by hand.
4. **Place.** Select a control in the checklist — or press it on the controller —
   then drag on the image to draw its label box (a click drops a box the size of
   the last one). The editor jumps to the next unplaced control.
   - Drag a box to move it, drag its handles to resize, arrow keys nudge (Shift = 10 px),
     Delete removes the box.
   - Boxes snap to other boxes' edges; the grid button adds a snapping grid.
   - Shift-click several boxes to **align** their left or top edges, or give them the
     **same size as the last box**.
   - Axis halves (`Pos_Joy_XAxis`, `Neg_Joy_XAxis`) automatically share their axis's
     box. **Share box with previous** puts two controls in one box (e.g. a hat's
     four directions).
   - Ctrl + wheel (or pinch) zooms; Space-drag, middle-drag or the hand tool pans.
   - Ctrl+Z / Ctrl+Shift+Z undo and redo.
5. **Name.** Give each control a friendly label ("Pinky trigger", "H2 Up").
   Optionally add one of Elite's icon tokens (for example `[x52prox]` or
   `[ps4PadU]`); they show as icons in-game when the `.buttonMap` is used.
6. **Check.** Press controls to see their boxes light up, switch to **Filler text**
   to check long action names still fit, and work through the validation list
   (controls without a box, overlapping or off-image boxes, duplicate labels,
   missing IDs, schema errors). Click an entry to jump to it.
7. **Export.**
   - **Download .zip** gives you the files in the repository's layout:
     ```
     devices/<id>/device.json
     devices/<id>/<id>.webp
     buttonmaps/<bindsId>.buttonMap
     CONTRIBUTING-DEVICE.md
     ```
   - **Save to this browser** makes the device usable in the app straight away
     (cards, live input, the table). Saved devices are listed under *Mine* in the
     device browser, where you can export them as a `.zip` again or delete them.
     A `.zip` can be imported back into the browser (Devices → Import .zip) or into
     the editor.

## By hand

Create `devices/<id>/device.json` (the folder name **must** equal `id`):

```json
{
  "$schema": "../../schemas/device.schema.json",
  "id": "My-Stick",
  "name": "Maker My Stick",
  "source": "user",
  "ids": [{ "bindsId": "12345678", "usb": { "vid": "1234", "pid": "5678" } }],
  "images": [{ "file": "My-Stick.webp", "width": 3840, "height": 2160 }],
  "controls": [
    {
      "bindsId": "12345678",
      "key": "Joy_1",
      "label": "Trigger",
      "kind": "button",
      "image": 0,
      "box": { "x": 1964, "y": 618, "w": 642, "h": 54 }
    },
    { "bindsId": "12345678", "key": "Joy_XAxis", "label": "Stick X [x52prox]", "kind": "axis" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Folder name: letters, digits and dashes. |
| `name` | Shown everywhere in the app. |
| `source` | `user` for new contributions. `edrefcard2` and `edcd` mark imported data. |
| `ids[]` | Every Elite device ID this definition handles, exactly as written in the `Device` attribute of `.binds` files, with optional `deviceIndex` and USB `vid`/`pid` (4 upper-case hex digits each). |
| `keyBindsIds` | Optional: only choose this card when one of these IDs is in use (EDRefCard *KeyDevices*). |
| `images[]` | Artwork file names (in the same folder) with their pixel size. May be empty. |
| `controls[]` | One entry per control **per Elite ID**: `bindsId` (+ `deviceIndex`), Elite `key` (`Joy_3`, `Joy_XAxis`, `Joy_POV1Up`, `Pos_Joy_XAxis`, `GamePad_FaceDown`…), `label`, `kind` (`button`, `axis` or `hat`), and optionally `image` (index into `images`) and `box`. |
| `inputCorrections` | Optional browser live-input fixes per `bindsId`: `buttonOffset`, and `axisMap` (browser axis index → Elite axis key). |

**Box coordinates** are in pixels of the image, with the origin at the top-left:
`x`/`y` is the box's top-left corner, `w`/`h` its size. Boxes hold the text on the
reference card, so make them wide enough for long action names (the editor's
*Filler text* preview helps). Controls that share a box (an axis and its halves, a
hat's directions) simply repeat the same box.

If a device reports under several IDs (revisions, or a named ID such as
`SaitekX56Joystick` as well as `07382221`), list them all in `ids` and repeat the
controls for each ID.

### Check it

Inside the dev container (see [CLAUDE.md](../CLAUDE.md)):

```sh
npm run devices:check
```

This validates every `device.json` against the schema and checks that `id` matches
the folder name, that every image exists, that `controls[].image` points at an
existing image, and that a `user` device doesn't claim an Elite ID (and index)
that another device already handles. Then run `npm start`, open
**Devices → your device** and switch on **Boxes only** to see every box on the
artwork.

## Imported devices

Most bundled devices were converted from other projects by `npm run import-data`:

- **EDRefCard 2** (`source: "edrefcard2"`) — artwork and box layouts from
  EDRefCard's *hotasDetails*. Their images are 3840×2160 and often include
  printed leader lines, so boxes line up with the drawing.
- **EDCD EliteCustomButtonNames** (`source: "edcd"`, folders named `EDCD-<ID>`) —
  button names only, no artwork. They work for editing and live input; add an
  image and boxes with the layout editor to give them a reference card.

Improving an imported device is welcome: open it in the editor, fix it, export,
and replace its whole folder in your pull request. The export uses
`source: "user"`, and `npm run import-data` never overwrites folders with that
source, so your fixes survive future re-imports.

## Credit and licence

- Only add images you have the right to share: your own photo or drawing, or
  artwork whose licence allows redistribution. Manufacturer marketing images
  usually may not be redistributed. Say where the image came from in the pull
  request.
- Data adapted from EDRefCard and EDCD stays under their MIT licences (see
  [LICENSE](../LICENSE)).
- The exported `.buttonMap` also works in-game (copy it to Elite's
  `ControlSchemes/DeviceButtonMaps` folder) and can be offered upstream to
  [EDCD/EliteCustomButtonNames](https://github.com/EDCD/EliteCustomButtonNames).
