import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then((m) => m.Home), title: 'Elite Dangerous Bindings' },
  {
    path: 'bindings',
    loadComponent: () => import('./features/bindings/bindings-page').then((m) => m.BindingsPage),
    title: 'Bindings · ED Bindings',
  },
  {
    path: 'cards',
    loadComponent: () => import('./features/cards/cards-page').then((m) => m.CardsPage),
    title: 'Reference cards · ED Bindings',
  },
  {
    path: 'live',
    loadComponent: () => import('./features/live/live-page').then((m) => m.LivePage),
    title: 'Live input · ED Bindings',
  },
  { path: 'devices', loadChildren: () => import('./features/devices/devices.routes').then((m) => m.DEVICE_ROUTES) },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about').then((m) => m.About),
    title: 'About · ED Bindings',
  },
  { path: '**', redirectTo: '' },
];
