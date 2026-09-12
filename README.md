# opencode-status-pill — panel-native

> **npm: `opencode-status-pill`** — `traffic-light` bin alias preserved.

**3-dot pill in GNOME top bar:**

- 🟢 **green** `#2ecc71` — idle / finished
- 🟡 **yellow** `#ffcc00` — working
- 🔴 **red** `#ff453a` — needs you (permission / question)
- 🟣 **magenta** `#bf5af2` — error (sticky until new session)

![demo](demo.gif)

## How it works

```
opencode TUI(s) ──events──▶ traffic-light.js (:4390) ──HTTP──▶ GNOME extension
```

1. **`traffic-light.js`** — opencode plugin (Bun). Tracks `Map<sid, {color, reason, since, cwd}>`. Serves `GET /status`, `GET /health`, `POST /event` (token-gated). Priority `error > red > yellow > green`. Stale if `now - lastEvent > staleMs` (5m default).
2. **`extension/opencode-status-pill@local`** — GNOME 45–51 extension. Polls `/status` every `pollMs`, shows active dot, popup lists sessions with elapsed/stale.
3. **`traffic-light` CLI + `setup.sh`** — installer and tooling.

## Setup

```sh
git clone https://github.com/x0shreyash/opencode-status-pill.git ~/projects/opencode-status-pill
cd ~/projects/opencode-status-pill
./setup.sh
# logout/login if fresh install, then restart TUI
opencode
curl -H "x-traffic-token: $(cat ~/.config/opencode-status-pill/token)" http://127.0.0.1:4390/status
```

`setup.sh` links CLI to `~/.local/bin`, creates token at `~/.config/opencode-status-pill/token`, installs plugin to `~/.config/opencode/plugins/traffic-light/`, installs extension to `~/.local/share/gnome-shell/extensions/opencode-status-pill@local/`.

## Daily use

```sh
opencode-status-pill status          # health / status
opencode-status-pill sessions        # table of sessions
opencode-status-pill history <sid>   # last 10 state changes
opencode-status-pill waybar          # JSON for waybar
opencode-status-pill doctor          # checklist
opencode-status-pill logs            # shell logs
# prefs: gnome-extensions prefs opencode-status-pill@local
```

Config: `~/.config/opencode-status-pill/config.json` — `pollMs`, `staleMs`, `colors`, `sizes` (hot-reloaded).

## Files

| File | What |
|---|---|
| `traffic-light.js` / `package.json` | opencode plugin |
| `extension/opencode-status-pill@local/` | GNOME extension |
| `traffic-light` | CLI |
| `tests/` | tests |
| `setup.sh` | installer |
| `demo.gif` | demo |

## Gotchas

- `opencode.jsonc` overrides `opencode.json` — check `opencode debug config`.
- Plugins load at TUI startup only — restart TUI after changes.

## Requirements

- GNOME 45–51
- opencode ≥ 1.18
- `gnome-extensions` CLI

## Changelog

See `CHANGELOG.md`.
