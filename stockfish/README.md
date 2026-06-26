# Stockfish engine files

The extension looks for these optional local files:

- `stockfish-18-lite-single.js`
- `stockfish-18-lite-single.wasm`

When they are absent, the extension loads the same Stockfish 18.0.8 files from UNPKG at runtime.

To store the engine inside this GitHub repository, open the repository's **Actions** tab and run the **Vendor Stockfish 18** workflow. The workflow downloads and commits both files automatically.

Stockfish.js is licensed under GPL-3.0:

- Source: `https://github.com/nmrugg/stockfish.js`
- Original Stockfish source: `https://github.com/official-stockfish/Stockfish`
