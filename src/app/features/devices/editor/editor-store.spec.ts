import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogService } from '../../../core/data/catalog.service';
import { IDB_FACTORY, LocalDeviceStore } from '../../../core/devices/local-device-store.service';
import { EditorStore } from './editor-store';
import { controlsFromCounts } from './inventory';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      EditorStore,
      { provide: IDB_FACTORY, useValue: null },
      {
        provide: CatalogService,
        useValue: { devices: signal([]), deviceFor: () => undefined, setLocalDevices: () => undefined, whenReady: async () => undefined },
      },
    ],
  });
  return { store: TestBed.inject(EditorStore), local: TestBed.inject(LocalDeviceStore) };
}

describe('EditorStore', () => {
  it('derives the folder id from the name until it is typed', async () => {
    const { store } = setup();
    await store.open(null);
    store.setName('Thrustmaster T.16000M (Left)');
    expect(store.draft().id).toBe('Thrustmaster-T-16000M-Left');
    store.setId('My-Id');
    store.setName('Other');
    expect(store.draft().id).toBe('My-Id');
  });

  it('prefills an ID and treats later IDs as revisions of the first', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '231d0200' });
    expect(store.draft().ids[0]).toMatchObject({ bindsId: '231D0200', usb: { vid: '231D', pid: '0200' } });
    expect(store.addId('231D3200')).toBe(true);
    expect(store.addId('231D3200')).toBe(false);
    expect(store.draft().ids[1].aliasOf).toBe(store.draft().ids[0].uid);
    expect(store.primaries().length).toBe(1);
    store.setAlias(store.draft().ids[1].uid, null);
    expect(store.primaries().length).toBe(2);
  });

  it('undoes and redoes, coalescing typing', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.addControls(controlsFromCounts(2, 0, 0));
    expect(store.draft().controls.length).toBe(2);
    const uid = store.draft().controls[0].uid;
    store.updateControl(uid, { label: 'T' }, `label:${uid}`);
    store.updateControl(uid, { label: 'Tr' }, `label:${uid}`);
    store.updateControl(uid, { label: 'Trigger' }, `label:${uid}`);
    store.undo();
    expect(store.draft().controls[0].label).toBe('Button 1');
    store.undo();
    expect(store.draft().controls.length).toBe(0);
    store.redo();
    store.redo();
    expect(store.draft().controls[0].label).toBe('Trigger');
    expect(store.canRedo()).toBe(false);
  });

  it('autosaves the draft and restores it', async () => {
    vi.useFakeTimers();
    const { store, local } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.setName('Saved stick');
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    await Promise.resolve();
    const saved = await local.loadDraft<{ name: string }>('new');
    expect(saved?.name).toBe('Saved stick');
    await store.open(null);
    expect(store.restored()).toBe(true);
    expect(store.draft().name).toBe('Saved stick');
  });

  it('moves boxes with their image and advances to the next unplaced control', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.addImages([
      { uid: 'i1', name: 'a', blob: new Blob([]), type: 'webp', width: 100, height: 100 },
      { uid: 'i2', name: 'b', blob: new Blob([]), type: 'webp', width: 100, height: 100 },
    ]);
    store.addControls(controlsFromCounts(3, 0, 0));
    const [a, b] = store.draft().controls;
    store.imageIndex.set(1);
    store.setBoxes(new Map([[a.uid, { x: 1, y: 1, w: 10, h: 10 }]]));
    expect(store.draft().controls[0].image).toBe(1);
    expect(store.nextUnplaced(a.uid)?.uid).toBe(b.uid);
    store.removeImage(0);
    expect(store.draft().controls[0].image).toBe(0);
    store.removeImage(0);
    expect(store.draft().controls[0].box).toBeUndefined();
  });

  it('edits leader lines with undo, keeps them when boxes move and drops them with the box', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.addImages([{ uid: 'i1', name: 'a', blob: new Blob([]), type: 'webp', width: 1000, height: 500 }]);
    store.addControls(controlsFromCounts(2, 0, 0));
    const [a, b] = store.draft().controls;
    store.setLeader(b.uid, [{ x: 5, y: 5 }]);
    expect(store.draft().controls[1].leader).toBeUndefined(); // no box, no line
    store.setBoxes(new Map([[a.uid, { x: 10, y: 10, w: 100, h: 20 }]]));
    store.setLeader(a.uid, [{ x: 400, y: 300 }]);
    store.setLeader(a.uid, [{ x: 200, y: 300 }, { x: 400, y: 300 }]);
    store.setBoxes(new Map([[a.uid, { x: 50, y: 10, w: 100, h: 20 }]]));
    expect(store.draft().controls[0].leader).toEqual([{ x: 200, y: 300 }, { x: 400, y: 300 }]);
    store.undo();
    store.undo();
    expect(store.draft().controls[0].leader).toEqual([{ x: 400, y: 300 }]);
    store.redo();
    store.setLeader(a.uid, null);
    expect(store.draft().controls[0].leader).toBeUndefined();
    store.undo();
    expect(store.draft().controls[0].leader?.length).toBe(2);
    store.removeBoxes([a.uid]);
    expect(store.draft().controls[0].leader).toBeUndefined();
  });

  it('keeps canvas settings in the draft with undo, and exports boxes beside the photo on a grown canvas', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.setName('T');
    store.addImages([{ uid: 'i1', name: 'a', blob: new Blob([]), type: 'webp', width: 400, height: 300 }]);
    store.addControls(controlsFromCounts(1, 0, 0));
    const [a] = store.draft().controls;
    store.setBoxes(new Map([[a.uid, { x: 350, y: 10, w: 100, h: 20 }]]));
    expect(store.definition().images[0]).toMatchObject({ width: 498, height: 300 });
    expect(store.definition().controls[0].box).toEqual({ x: 350, y: 10, w: 100, h: 20 });
    store.setCanvas({ margin: 0, background: { kind: 'color', color: '#ff0000' } });
    expect(store.definition().images[0].width).toBe(450);
    store.undo();
    expect(store.canvas()).toMatchObject({ margin: 48, background: { kind: 'auto' } });
    // The draft keeps the photo as it is.
    expect(store.draft().images[0].width).toBe(400);
  });

  it('turns box outlines on when a new image is uploaded, and lets the user toggle them (undoable)', async () => {
    const { store } = setup();
    await store.open(null, { bindsId: '12345678' });
    store.update((d) => ({ ...d, baseId: 'Edited', drawBoxes: false }));
    store.addImages([{ uid: 'i1', name: 'photo', blob: new Blob([]), type: 'webp', width: 400, height: 300 }]);
    expect(store.draft().drawBoxes).toBe(true);
    store.setDrawBoxes(false);
    expect(store.definition().drawBoxes).toBeUndefined();
    store.undo();
    expect(store.definition().drawBoxes).toBe(true);
  });
});
