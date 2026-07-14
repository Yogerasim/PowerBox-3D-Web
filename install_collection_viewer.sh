#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_JSON="$PROJECT_DIR/package.json"

[[ -f "$PACKAGE_JSON" ]] || { echo "package.json not found. Run inside PowerBox-3D-Web." >&2; exit 1; }

chmod +x "$PROJECT_DIR/run_export_collections.sh" "$PROJECT_DIR/install_collection_viewer.sh"

node - "$PACKAGE_JSON" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.scripts ??= {};
pkg.scripts['export:collections'] = './run_export_collections.sh';
pkg.scripts['viewer:dev'] = 'vite --open /viewer.html';
pkg.scripts['viewer:build'] = 'vite build';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
NODE

npm install
npm run build

printf '\n[PowerBox] Collection viewer installed.\n'
printf '\nExport:\n  npm run export:collections\n'
printf '\nViewer:\n  npm run viewer:dev\n\n'
