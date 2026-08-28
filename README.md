# shizumu

a private thinking space.

> write to think.
> pin what matters.
> trail what continues.
> the rest sinks.

## quick start

```bash
npm install
npm run dev             # web version at http://localhost:1420
```

## build

```bash
npm install
npm run build           # frontend → dist/
npx tauri build         # desktop app (Linux: deb, rpm; requires system libs)
```

### linux prerequisites (fedora)

```bash
sudo dnf install webkit2gtk4.1-devel libsoup3-devel javascriptcoregtk4.1-devel gtk3-devel
```

## how the app works

- writing is offline by default — no account needed, no data leaves your device.
- sync requires a relay server. the app ships pointing at the official relay
  (`relay.shizumu.app`) when sync is enabled. to run your own relay see
  [shizumu-relay](https://github.com/shizumu-app/shizumu-relay).
- to change the relay url: **settings → sync → relay url**.

## tech stack

- **desktop:** svelte 5 + tauri 2 (rust backend)
- **database:** sqlite via sqlx (local-first)
- **sync:** end-to-end encrypted, zero-knowledge relay

## license

apache-2.0. see [LICENSE](./LICENSE). the sync relay is a separate
repository and stays agpl-3.0-or-later: [shizumu-relay](https://github.com/shizumu-app/shizumu-relay).
