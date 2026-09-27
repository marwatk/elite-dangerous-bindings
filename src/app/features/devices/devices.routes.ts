import { Routes } from '@angular/router';

export const DEVICE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./device-list').then((m) => m.DeviceList),
    title: 'Devices · ED Bindings',
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/layout-editor').then((m) => m.LayoutEditor),
    title: 'Map a new controller · ED Bindings',
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./editor/layout-editor').then((m) => m.LayoutEditor),
    title: 'Edit device layout · ED Bindings',
  },
  {
    path: ':id',
    loadComponent: () => import('./device-detail').then((m) => m.DeviceDetail),
    title: 'Device · ED Bindings',
  },
];
