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
   A tight photo of just the controller is fine: there's no need to leave room for
   the labels (see **Place**).
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
   - **Groups** put several controls in one box: a hat (4 or 8 directions, with or
     without a push), a rocker, a 3-position switch, an encoder, a ministick's axes
     and click… Tick the controls and choose **Group…**. Give the group a label
     (`H1`), pick **Stack** (one row per member) or **Row** (members side by side),
     drag the members into order, and give each a **marker**: arrows are filled in
     for hat directions, `+`/`−` for axis halves; otherwise pick one from the palette
     (↑ ↗ → ↘ ↓ ↙ ← ↖ ● ⟳ ⟲ ↕ ↔ ± + −) or type a short text such as `Fwd` or `1`.
     Members are named after the group (`H1 ↑`) unless you renamed them; the names
     go to the table, Live input and the `.buttonMap`. **Edit** changes a group,
     **Ungroup** splits it again.
4. **Place.** Select a control in the checklist — or press it on the controller —
   then drag on the image to draw its label box (a click drops a box the size of
   the last one). The editor jumps to the next unplaced control.
   - Drag a box to move it, drag its handles to resize, arrow keys nudge (Shift = 10 px),
     Delete removes the box.
   - Boxes snap to other boxes' edges; the grid button adds a snapping grid.
   - Shift-click several boxes to **align** their left or top edges, or give them the
     **same size as the last box**.
   - Axis halves (`Pos_Joy_XAxis`, `Neg_Joy_XAxis`) automatically share their axis's
     box.
   - A group is one item in the checklist and one box on the image, drawn split
     into its members' rows (or cells) with the label in a column on the left.
     Pressing any member on the controller selects the group; **Edit group…**
     changes it. **Share box with previous** puts two controls in one box (e.g. a hat's
     four directions).
   - **Leader lines** connect a box to the control it labels (bundled EDRefCard
     artwork has them printed on it; your own photo doesn't). Select a box and press
     **L** (or the line button, or **Draw line**), then click the control; Alt-click
     on the control does the same in one step, and moves the anchor of an existing
     line. Drag the dot to move the anchor, click the line to add a bend (drag it;
     Delete removes a selected bend), and **Remove line** deletes it. Moving or
     resizing the box keeps the anchor where it is: the line starts on the box edge
     nearest to it.
   - **Boxes can go beside the photo.** The workspace always extends well past the
     image, and grows as you draw or move boxes towards its edge. The exported image
     grows to hold everything drawn (boxes and leader lines) plus a margin — the
     dashed outline shows its extent — and boxes and lines are moved to match. If
     everything is on the photo, the image is exported unchanged. The **Canvas**
     button sets the fill of the new area: **Auto-detect** (default; the most common
     colour of the photo's border, or its median colour with a note when the border
     is busy), a **Colour** (picker or swatches), or **Transparent** (WebP keeps the
     alpha; cards and diagrams show white behind it). It also sets the **margin**
     (default 48 px), an optional **Keep 16:9**, and shows the output size. These
     settings are saved with your work and can be undone.
   - Ctrl + wheel (or pinch) zooms; Space-drag, middle-drag or the hand tool pans.
   - Ctrl+Z / Ctrl+Shift+Z undo and redo.
5. **Name.** Give each control a friendly label ("Pinky trigger", "H2 Up").
   Optionally add one of Elite's icon tokens (for example `[x52prox]` or
   `[ps4PadU]`); they show as icons in-game when the `.buttonMap` is used.
6. **Check.** Press controls to see their boxes light up, switch to **Filler text**
   to check long action names still fit, and work through the validation list
   (controls without a box, overlapping or off-image boxes, duplicate labels,
   missing IDs, schema errors, groups with fewer than 2 controls or missing or
   repeated markers). Click an entry to jump to it. Hints (only
   suggestions) list boxes beside the photo with the size the image grows to, and,
   on your own images, boxes without a leader line. The preview shows the image as
   it will be exported.
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
      "box": { "x": 1964, "y": 618, "w": 642, "h": 54 },
      "leader": [{ "x": 1800, "y": 645 }, { "x": 1520, "y": 700 }]
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
| `controls[]` | One entry per control **per Elite ID**: `bindsId` (+ `deviceIndex`), Elite `key` (`Joy_3`, `Joy_XAxis`, `Joy_POV1Up`, `Pos_Joy_XAxis`, `GamePad_FaceDown`…), `label`, `kind` (`button`, `axis` or `hat`), and optionally `image` (index into `images`), `box` and `leader`. |
| `drawBoxes` | Optional `true`: the artwork has no printed boxes (a photo), so cards and diagrams draw each box as an outline with a light fill behind the text, and show every box even when nothing is bound to it. The layout editor always sets it. |
| `groups[]` | Optional control groups: several controls sharing one box (see below). |
| `inputCorrections` | Optional browser live-input fixes per `bindsId`: `buttonOffset`, and `axisMap` (browser axis index → Elite axis key). |

**Box coordinates** are in pixels of the image, with the origin at the top-left:
`x`/`y` is the box's top-left corner, `w`/`h` its size. Boxes hold the text on the
reference card, so make them wide enough for long action names (the editor's
*Filler text* preview helps). Controls that share a box (an axis and its halves, a
hat's directions) simply repeat the same box.

**Groups** put several controls — any number, any kind — in one box, e.g. a hat
with a push:

```json
"groups": [
  {
    "id": "H1",
    "label": "H1",
    "layout": "stack",
    "image": 0,
    "box": { "x": 2400, "y": 300, "w": 700, "h": 270 },
    "members": [
      { "bindsId": "12345678", "key": "Joy_POV1Up", "marker": "↑" },
      { "bindsId": "12345678", "key": "Joy_POV1Right", "marker": "→" },
      { "bindsId": "12345678", "key": "Joy_POV1Down", "marker": "↓" },
      { "bindsId": "12345678", "key": "Joy_POV1Left", "marker": "←" },
      { "bindsId": "12345678", "key": "Joy_5", "marker": "●" }
    ]
  }
]
```

The box is split into one row per member (`"layout": "stack"`, the default) or one
cell per member side by side (`"row"`), in member order. The group's `label` is a
column on the left, reading bottom to top (`"showLabel": false` drops it). Each
row starts with its `marker`: one of ↑ ↗ → ↘ ↓ ↙ ← ↖ ● ⟳ ⟲ ↕ ↔ ± + − (drawn as
symbols) or short text. Members stay in `controls` (with their names) but have no
`box` or `leader` of their own; a control is in at most one group, markers are
unique within a group, and a group has at least two members. `leader` works as for
controls. List the group once per Elite ID (with that ID's `bindsId`), like the
controls.

Card text is sized from the box height (about three quarters of a one-line box),
so small images get text as large as their boxes allow; taller boxes wrap.

**Leader lines** (`leader`, optional, only with a `box`) are points in the same image
pixels: the **last** point is the anchor on the control, any earlier points are bends
along the way. The line starts on the edge of the box nearest to the first point —
that start is worked out when drawing, not stored. The app draws the line with a dot
at the anchor, under the label, on the device diagram and the reference card. Leave
it out for artwork that already has lines printed on it.

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
