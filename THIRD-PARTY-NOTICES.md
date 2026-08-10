# third-party notices

shizumu is licensed under AGPL-3.0-or-later. It redistributes the following
third-party assets, which carry their own licences.

## Fonts

Four font files ship in `public/fonts/` and are embedded in the application
binary. All are licensed under the **SIL Open Font License, Version 1.1**, which
requires that this licence accompany the fonts wherever they are redistributed.
The full text is in [`public/fonts/OFL.txt`](./public/fonts/OFL.txt).

| File | Family | Copyright |
|---|---|---|
| `Lora-Regular.woff2` | Lora | Copyright © The Lora Project Authors — <https://github.com/cyrealtype/Lora-Cyrillic> |
| `Lora-Italic.woff2` | Lora | Copyright © The Lora Project Authors — <https://github.com/cyrealtype/Lora-Cyrillic> |
| `DMMono-Light.woff2` | DM Mono | Copyright © The DM Mono Project Authors — <https://github.com/googlefonts/dm-mono> |
| `Inter-Variable.woff2` | Inter | Copyright © The Inter Project Authors — <https://github.com/rsms/inter> |

The OFL permits redistribution and embedding, including in commercial products,
provided the licence travels with the font files and the fonts are not sold on
their own. Reserved Font Names, where declared by the upstream project, must not
be used for modified versions.

## Software dependencies

Runtime and build dependencies are declared in `package.json` /
`package-lock.json` (npm) and `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`
(Rust crates). Each carries its own licence; the lockfiles pin exact versions
and integrity hashes so the full set is reproducible.

To enumerate them:

```bash
npm ls --all --long          # npm tree with licence fields
cargo tree                   # rust dependency tree
cargo license                # per-crate licences (needs cargo-license)
```

## Runtime platform

The flatpak build runs against the GNOME runtime (`org.gnome.Platform`) and
links `libayatana-appindicator` for system-tray support. These are provided by
the runtime and are not redistributed in this repository; see
`flatpak/app.shizumu.Shizumu.yml`.
