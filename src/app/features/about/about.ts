import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Credit {
  name: string;
  url: string;
  who: string;
  licence: string;
  what: string;
}

@Component({
  selector: 'app-about',
  imports: [RouterLink],
  template: `
    <div class="page">
      <div class="page-header"><h1>About</h1></div>
      <p>
        A browser-based tool for viewing, editing and printing Elite Dangerous bindings. Your files never leave
        your browser.
      </p>
      <p class="note">
        This project is written entirely by AI ("vibe coded") with
        <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude</a>. Its own code is in the
        public domain (Unlicense). Data and artwork from the projects below keep their own licences.
      </p>

      <h2>Source code</h2>
      <p>
        <a [href]="repo" target="_blank" rel="noopener">{{ repoLabel }}</a> on GitHub. Report problems and ideas in its
        <a [href]="repo + '/issues'" target="_blank" rel="noopener">issues</a>. To add a controller, map it on the
        <a routerLink="/devices">Devices</a> page and open a pull request with the exported files; see
        <a [href]="repo + '/blob/main/docs/adding-a-device.md'" target="_blank" rel="noopener">adding a device</a>.
      </p>

      <h2>Credits</h2>
      <ul class="credits">
        @for (c of credits; track c.name) {
          <li>
            <a [href]="c.url" target="_blank" rel="noopener">{{ c.name }}</a> by {{ c.who }}
            <span class="muted">({{ c.licence }})</span>: {{ c.what }}
          </li>
        }
      </ul>
      <p class="muted">
        Elite Dangerous is a trademark of Frontier Developments plc. This tool is not affiliated with or endorsed by
        Frontier. Controller names are trademarks of their makers.
      </p>
    </div>
  `,
  styles: `
    .note {
      padding: 12px 16px;
      border-left: 3px solid var(--edb-accent);
      background: var(--edb-accent-soft);
      border-radius: 4px;
    }
    .credits li {
      margin-bottom: 8px;
    }
  `,
})
export class About {
  protected readonly repo = 'https://github.com/marwatk/elite-dangerous-bindings';
  protected readonly repoLabel = 'marwatk/elite-dangerous-bindings';
  protected readonly credits: Credit[] = [
    { name: 'EdBindings', url: 'https://github.com/ghorsey/EdBindings', who: 'Geoff (ghorsey)', licence: 'MIT', what: 'bindings table, action names, device label mappings, bindED variable names' },
    { name: 'EDRefCard 2', url: 'https://github.com/brammmers/edrefcard2', who: 'brammmers, forked from EDRefCard by Richard Buckle and CMDR jgm', licence: 'MIT', what: 'reference cards, controller artwork and layouts, command metadata' },
    { name: 'EliteCustomButtonNames', url: 'https://github.com/EDCD/EliteCustomButtonNames', who: 'EDCD / Richard Buckle', licence: 'MIT', what: 'button names for 38 controllers' },
    { name: 'Bindwing', url: 'https://github.com/derrickmehaffy/bindwing', who: 'Derrick Mehaffy', licence: 'MIT', what: 'live WebHID/Gamepad input approach' },
    { name: 'bindsmith', url: 'https://github.com/bullwinkle3000/bindsmith', who: 'Andrew Langton', licence: 'MIT', what: 'device re-targeting approach' },
    { name: 'elite-dangerous-binds-editor', url: 'https://github.com/mholtmanns/elite-dangerous-binds-editor', who: 'mholtmanns', licence: 'Unlicense', what: 'editing ideas' },
    { name: 'EDBV', url: 'https://github.com/DRA6N/EDBV', who: 'DRA6N', licence: 'MIT', what: 'action area and category table' },
    { name: 'EliteBinding', url: 'https://github.com/trasa/EliteBinding', who: 'Tony Rasa', licence: 'MIT', what: 'short action labels, sample bindings file' },
    { name: 'EDRefKB', url: 'https://github.com/RealOfficialTurf/EDRefKB', who: 'RealOfficialTurf', licence: 'MIT', what: 'keyboard key names' },
    { name: 'Material Symbols', url: 'https://github.com/google/material-design-icons', who: 'Google', licence: 'Apache 2.0', what: 'icons, including the joystick app icon' },
  ];
}
