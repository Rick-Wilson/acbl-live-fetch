# Third-Party Licences

Bridge Classroom Fetch is released under [The Unlicense](LICENSE). It
bundles the following third-party code into its published builds.

Both are compiled into the extension bundle by Vite, so their licence terms
travel with every store submission.

---

## linkedom — ISC

A pure-JavaScript DOM used to polyfill `DOMParser`, which MV3 service workers do
not provide. Parsers run identically in the worker and in content scripts as a
result.

- Version: 0.18.12
- Source: https://github.com/WebReflection/linkedom
- Licence: ISC

```
ISC License

Copyright (c) 2020, Andrea Giammarchi

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

---

## webextension-polyfill — MPL-2.0

Mozilla's `browser.*` promise-based wrapper over the callback-style `chrome.*`
APIs, so one source tree runs on Chrome, Firefox, Edge and Safari.

- Version: 0.12.0
- Source: https://github.com/mozilla/webextension-polyfill
- Licence: Mozilla Public License 2.0 — https://mozilla.org/MPL/2.0/

MPL-2.0 is a file-level copyleft. The polyfill is used unmodified; if it is ever
patched, those modified files must be published under MPL-2.0. Nothing else in
this project is affected, and the licence permits distribution in a larger work
under different terms — which is what a bundled extension is.

The full licence text ships in `node_modules/webextension-polyfill/LICENSE` and
is available at the URL above.

---

## Not bundled

Build and test tooling — Vite, `@crxjs/vite-plugin`, Vitest, Playwright,
Prettier, jsdom — is `devDependencies` only and forms no part of any published
build.
