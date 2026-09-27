#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="$HOME/.codex/jev-router"
BIN_DIR="$HOME/.local/bin"

command -v node >/dev/null 2>&1 || {
  printf '%s\n' 'Node.js is required to install the global Jev helper.' >&2
  exit 1
}
NODE_BIN="$(command -v node)"
INSTALL_HOME="$HOME"
SAFE_PATH='/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
chmod 700 "$INSTALL_DIR" "$BIN_DIR"
install -m 700 "$SCRIPT_DIR/codex-route" "$INSTALL_DIR/codex-route"
install -m 700 "$SCRIPT_DIR/jev-keychain-bridge.mjs" "$INSTALL_DIR/jev-keychain-bridge.mjs"
install -m 700 "$SCRIPT_DIR/jev-route.mjs" "$INSTALL_DIR/jev-route.mjs"
install -m 600 "$SCRIPT_DIR/codex-model-catalog.json" "$INSTALL_DIR/codex-model-catalog.json"
install -m 700 "$SCRIPT_DIR/codex-route" "$BIN_DIR/codex-route"

if [[ ! -e "$INSTALL_DIR/settings.json" ]]; then
  install -m 600 /dev/null "$INSTALL_DIR/settings.json"
  printf '%s\n' \
    '{' \
    '  "keychainService": "codex-route-typesafe",' \
    '  "keychainAccount": null' \
    '}' > "$INSTALL_DIR/settings.json"
fi

cat > "$BIN_DIR/jev-route" <<'EOF'
#!/bin/sh
set -eu
exec /usr/bin/env -i HOME='INSTALL_HOME_PLACEHOLDER' PATH='SAFE_PATH_PLACEHOLDER' LANG="${LANG:-C}" TMPDIR="${TMPDIR:-/tmp}" \
  'NODE_BIN_PLACEHOLDER' 'INSTALL_DIR_PLACEHOLDER/jev-route.mjs' "$@"
EOF

cat > "$BIN_DIR/jev-bridge-run" <<'EOF'
#!/bin/sh
set -eu
exec /usr/bin/env -i HOME='INSTALL_HOME_PLACEHOLDER' PATH='SAFE_PATH_PLACEHOLDER' LANG="${LANG:-C}" TMPDIR="${TMPDIR:-/tmp}" \
  'NODE_BIN_PLACEHOLDER' 'INSTALL_DIR_PLACEHOLDER/jev-keychain-bridge.mjs' "$@"
EOF

sed -i '' -e "s|NODE_BIN_PLACEHOLDER|$NODE_BIN|g" -e "s|INSTALL_HOME_PLACEHOLDER|$INSTALL_HOME|g" -e "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" -e "s|SAFE_PATH_PLACEHOLDER|$SAFE_PATH|g" "$BIN_DIR/jev-route" "$BIN_DIR/jev-bridge-run"

chmod 700 "$BIN_DIR/jev-route" "$BIN_DIR/jev-bridge-run"
printf 'Installed the global Jev helper in %s and commands in %s.\n' "$INSTALL_DIR" "$BIN_DIR"
printf '%s\n' 'Keychain item metadata can be configured in ~/.codex/jev-router/settings.json; do not put the credential in that file.'
printf '%s\n' 'Open AGENTS_TEMPLATE.md and merge its instructions into ~/.codex/AGENTS.md to enable Desktop routing.'
