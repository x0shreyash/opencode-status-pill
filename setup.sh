#!/bin/sh
# Setup for opencode-status-pill — panel-native (GNOME Shell extension)
# Idempotent: safe to re-run.
set -e
cd "$(dirname "$0")"

echo "== 1. CLI =="
chmod +x traffic-light
mkdir -p ~/.local/bin
ln -sf "$PWD/traffic-light" ~/.local/bin/traffic-light
ln -sf "$PWD/traffic-light" ~/.local/bin/opencode-status-pill
echo "  linked ~/.local/bin/traffic-light + opencode-status-pill"

echo "== 2. token (persistent) =="
mkdir -p ~/.config/opencode-status-pill
if [ -f ~/.config/opencode-status-pill/token ]; then
  echo "  token: exists ($(wc -c < ~/.config/opencode-status-pill/token | tr -d ' ') bytes)"
else
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 > ~/.config/opencode-status-pill/token
  else
    python3 -c "import secrets, pathlib; pathlib.Path.home().joinpath('.config/opencode-status-pill/token').write_text(secrets.token_hex(32))" 2>/dev/null || \
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > ~/.config/opencode-status-pill/token
  fi
  chmod 600 ~/.config/opencode-status-pill/token
  echo "  token: created at ~/.config/opencode-status-pill/token"
fi

echo "== 2b. config (pollMs, staleMs, colors, sizes) =="
CONFIG_FILE="$HOME/.config/opencode-status-pill/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'JSON'
{
  "pollMs": 500,
  "staleMs": 300000,
  "colors": {
    "red": "#ff453a",
    "yellow": "#ffcc00",
    "green": "#2ecc71",
    "error": "#bf5af2"
  },
  "sizes": {
    "pillPaddingV": 3,
    "pillPaddingH": 12,
    "borderWidth": 1,
    "pillHeight": 24,
    "spacing": 7
  }
}
JSON
  echo "  config: created at $CONFIG_FILE"
else
  echo "  config: exists at $CONFIG_FILE"
  python3 <<'PY' 2>/dev/null || true
import json, pathlib
p = pathlib.Path.home() / ".config/opencode-status-pill/config.json"
try:
  j = json.loads(p.read_text())
  changed=False
  if "sizes" not in j:
    j["sizes"] = {"pillPaddingV":3,"pillPaddingH":12,"borderWidth":1,"pillHeight":24,"spacing":7}
    changed=True
  for k in ["iconSize","fontSize"]:
    if k in j.get("sizes",{}):
      j["sizes"].pop(k, None)
      changed=True
  j.pop("panelPosition", None)
  defaults = {"pillPaddingV":3,"pillPaddingH":12,"borderWidth":1,"pillHeight":24,"spacing":7}
  for k,v in defaults.items():
    if k not in j["sizes"]:
      j["sizes"][k]=v
      changed=True
  if changed:
    p.write_text(json.dumps(j, indent=2))
    print("  migrated config.json to include sizes")
except: pass
PY
  if ! python3 -m json.tool "$CONFIG_FILE" >/dev/null 2>&1; then
    echo "  warn: $CONFIG_FILE is not valid JSON — keeping as-is"
  fi
fi

echo "== 3. opencode plugin =="
mkdir -p ~/.config/opencode/plugins/traffic-light
cp traffic-light.js package.json ~/.config/opencode/plugins/traffic-light/
if [ ! -f ~/.config/opencode/opencode.jsonc ]; then
  echo '{"$schema":"https://opencode.ai/config.json","plugin":[]}' > ~/.config/opencode/opencode.jsonc
fi
if grep -q "traffic-light" ~/.config/opencode/opencode.jsonc 2>/dev/null; then
  echo "  already registered in opencode.jsonc"
else
  python3 - "$HOME/.config/opencode/opencode.jsonc" <<'PYEOF'
import re, sys
p = sys.argv[1]
raw = open(p).read()
plug_re = re.compile(r'"plugin"\s*:\s*\[(.*?)\]', re.S)
entry = '"./plugins/traffic-light/traffic-light.js"'
if '"plugin"' not in raw:
    raw = raw.rstrip()
    assert raw.endswith('}'), "unexpected jsonc shape"
    raw = raw[: -1].rstrip() + ',\n  "plugin": [%s]\n}\n' % entry
elif 'traffic-light' not in raw:
    raw = plug_re.sub(lambda m: '"plugin": [%s, %s]' % (m.group(1).strip(), entry)
                      if m.group(1).strip() else '"plugin": [%s]' % entry, raw, count=1)
open(p, 'w').write(raw)
print("  registered in opencode.jsonc")
PYEOF
fi

echo "  checking effective config…"
if timeout 10 opencode debug config 2>/dev/null | python3 -c "
import json, sys
plugs = json.load(sys.stdin).get('plugin') or []
ok = any('traffic-light' in p for p in plugs)
print('  effective plugins:', 'OK (traffic-light present)' if ok else 'MISSING — restart TUI after setup')
sys.exit(0 if ok else 1)
"; then
  :
else
  echo "  (will be OK after TUI restart — plugins load at TUI start only)"
fi

echo "== 4. GNOME Shell extension (panel pill) =="
EXT_SRC="$PWD/extension/opencode-status-pill@x0shreyash.github.io"
EXT_DST="$HOME/.local/share/gnome-shell/extensions/opencode-status-pill@x0shreyash.github.io"
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
rm -rf "$EXT_DST"
cp -r "$EXT_SRC" "$EXT_DST"
echo "  copied to $EXT_DST"

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable opencode-status-pill@x0shreyash.github.io 2>/dev/null || true
  if gnome-extensions list --enabled 2>/dev/null | grep -q "opencode-status-pill@x0shreyash.github.io"; then
    echo "  extension: enabled"
  else
    echo "  extension: installed but not yet enabled (try: gnome-extensions enable opencode-status-pill@x0shreyash.github.io)"
    echo "  note: fresh install on Wayland requires logout/login to appear"
  fi
else
  echo "  gnome-extensions not found — copy done, enable manually"
fi

echo ""
echo "== 5. doctor =="
if [ -x "$PWD/traffic-light" ]; then
  "$PWD/traffic-light" doctor || true
else
  ~/.local/bin/traffic-light doctor || true
fi

echo ""
echo "Done."
