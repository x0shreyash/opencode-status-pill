import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const STATUS_URL = 'http://127.0.0.1:4390/status';
const DEFAULT_CONFIG = {
  pollMs: 500,
  staleMs: 5 * 60 * 1000,
  colors: { red: "#ff453a", yellow: "#ffcc00", green: "#2ecc71", error: "#bf5af2" },
  sizes: { pillPaddingV: 3, pillPaddingH: 12, borderWidth: 1, pillHeight: 24, spacing: 7 },
};

function fmtElapsed(ms) {
  if (ms < 10000) return `${Math.floor(ms / 1000)}s`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, '0')}m`;
}

function shortCwd(cwd) {
  if (!cwd) return 'global';
  let p = cwd;
  const home = GLib.get_home_dir();
  if (p.startsWith(home)) p = '~' + p.slice(home.length);
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join('/');
}

export default class TrafficLightExtension extends Extension {
  _loadConfig() {
    // Sync for initial enable — 280B file, acceptable; async also available via _loadConfigAsync
    try {
      const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'config.json']);
      const file = Gio.File.new_for_path(path);
      if (file.query_exists(null)) {
        const [ok, bytes] = file.load_contents(null);
        if (ok) {
          const j = JSON.parse(new TextDecoder().decode(bytes));
          const cfg = { ...DEFAULT_CONFIG, ...j, colors: { ...DEFAULT_CONFIG.colors, ...(j.colors || {}) } };
          const SZ = DEFAULT_CONFIG.sizes;
          const cur = j.sizes || {};
          cfg.sizes = { ...SZ, ...cur };
          const clampInt = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) && !isNaN(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
          cfg.sizes.pillPaddingV = clampInt(cfg.sizes.pillPaddingV, 0, 12, SZ.pillPaddingV);
          cfg.sizes.pillPaddingH = clampInt(cfg.sizes.pillPaddingH, 6, 24, SZ.pillPaddingH);
          cfg.sizes.borderWidth = clampInt(cfg.sizes.borderWidth, 0, 4, SZ.borderWidth);
          cfg.sizes.pillHeight = clampInt(cfg.sizes.pillHeight, 16, 36, SZ.pillHeight);
          cfg.sizes.spacing = clampInt(cfg.sizes.spacing, 0, 12, SZ.spacing);
          if (typeof cfg.pollMs !== 'number' || cfg.pollMs < 200) cfg.pollMs = DEFAULT_CONFIG.pollMs;
          if (typeof cfg.staleMs !== 'number' || cfg.staleMs < 1000) {
            if (typeof j.staleTimeoutMs === 'number') cfg.staleMs = j.staleTimeoutMs;
            else cfg.staleMs = DEFAULT_CONFIG.staleMs;
          }
          this._config = cfg;
          return cfg;
        }
      }
    } catch (e) {}
    this._config = { ...DEFAULT_CONFIG, sizes: { ...DEFAULT_CONFIG.sizes } };
    return this._config;
  }

  _loadConfigAsync() {
    try {
      const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'config.json']);
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (o, res) => {
        try {
          const [ok, bytes] = o.load_contents_finish(res);
          if (!ok) return;
          const j = JSON.parse(new TextDecoder().decode(bytes));
          const cfg = { ...DEFAULT_CONFIG, ...j, colors: { ...DEFAULT_CONFIG.colors, ...(j.colors || {}) } };
          const SZ = DEFAULT_CONFIG.sizes;
          const cur = j.sizes || {};
          cfg.sizes = { ...SZ, ...cur };
          const clampInt = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) && !isNaN(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
          cfg.sizes.pillPaddingV = clampInt(cfg.sizes.pillPaddingV, 0, 12, SZ.pillPaddingV);
          cfg.sizes.pillPaddingH = clampInt(cfg.sizes.pillPaddingH, 6, 24, SZ.pillPaddingH);
          cfg.sizes.borderWidth = clampInt(cfg.sizes.borderWidth, 0, 4, SZ.borderWidth);
          cfg.sizes.pillHeight = clampInt(cfg.sizes.pillHeight, 16, 36, SZ.pillHeight);
          cfg.sizes.spacing = clampInt(cfg.sizes.spacing, 0, 12, SZ.spacing);
          if (typeof cfg.pollMs !== 'number' || cfg.pollMs < 200) cfg.pollMs = DEFAULT_CONFIG.pollMs;
          if (typeof cfg.staleMs !== 'number' || cfg.staleMs < 1000) {
            if (typeof j.staleTimeoutMs === 'number') cfg.staleMs = j.staleTimeoutMs;
            else cfg.staleMs = DEFAULT_CONFIG.staleMs;
          }
          const oldPoll = this._config?.pollMs;
          this._config = cfg;
          if (cfg.pollMs !== oldPoll) this._restartPoll();
          this._updatePill(this._aggregate, !this._lastOk);
        } catch {}
      });
    } catch {}
  }

  _watchConfig() {
    try {
      const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill']));
      this._configMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      this._configMonitorId = this._configMonitor.connect('changed', (m, f, other, ev) => {
        const name = f.get_basename();
        if (name === 'config.json') this._loadConfigAsync();
        if (name === 'token') this._loadTokenAsync();
      });
    } catch {}
  }

  _restartPoll() {
    if (this._pollId) { GLib.Source.remove(this._pollId); this._pollId = null; }
    const ms = this._config?.pollMs || DEFAULT_CONFIG.pollMs;
    this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      this._poll();
      return GLib.SOURCE_CONTINUE;
    });
  }

  enable() {
    this._token = null;
    this._config = this._loadConfig();
    this._loadToken();

    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
    this._indicator.add_style_class_name('traffic-light');

    this._pill = new St.BoxLayout({ style_class: 'traffic-pill has-active', x_align: Clutter.ActorAlign.CENTER });
    this._dots = {};
    for (const c of ['red', 'yellow', 'green']) {
      const dot = new St.Widget({ style_class: `dot ${c}`, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
      this._dots[c] = dot;
      this._pill.add_child(dot);
    }
    this._indicator.add_child(this._pill);

    this._buildMenu();

    Main.panel.addToStatusArea(this.uuid, this._indicator);

    this._aggregate = 'green';
    this._sessions = [];
    this._session = new Soup.Session({ timeout: 2 });
    this._lastOk = false;

    this._updatePill('green', false);

    this._poll();
    this._restartPoll();

    this._tickerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      this._refreshElapsed();
      return GLib.SOURCE_CONTINUE;
    });

    this._watchConfig();
  }

  disable() {
    if (this._pollId) { GLib.Source.remove(this._pollId); this._pollId = null; }
    if (this._tickerId) { GLib.Source.remove(this._tickerId); this._tickerId = null; }
    if (this._configMonitor) {
      if (this._configMonitorId) { this._configMonitor.disconnect(this._configMonitorId); this._configMonitorId = null; }
      this._configMonitor.cancel(); this._configMonitor = null;
    }
    if (this._session) { this._session.abort(); this._session = null; }
    for (const it of this._rowItems || []) try { it.destroy(); } catch {}
    this._rowItems = null;
    try { this._rowsBox?.destroy(); } catch {}
    this._rowsBox = null;
    try { this._footerLabel?.destroy(); } catch {}
    this._footerLabel = null;
    this._indicator?.destroy();
    this._indicator = null;
    this._pill = null;
    this._dots = null;
    this._configMonitorId = null;
  }

  _loadToken() {
    try {
      const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'token']);
      const file = Gio.File.new_for_path(path);
      if (file.query_exists(null)) {
        const [ok, bytes] = file.load_contents(null);
        if (ok) {
          const txt = new TextDecoder().decode(bytes).trim();
          this._token = txt || null;
        }
      }
    } catch {}
  }

  _loadTokenAsync() {
    try {
      const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'token']);
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (o, res) => {
        try {
          const [ok, bytes] = o.load_contents_finish(res);
          if (!ok) return;
          const txt = new TextDecoder().decode(bytes).trim();
          this._token = txt || null;
        } catch {}
      });
    } catch {}
  }

  _buildMenu() {
    const header = new PopupMenu.PopupMenuItem('opencode traffic light', { reactive: false, style_class: 'traffic-empty' });
    header.sensitive = false;
    this._indicator.menu.addMenuItem(header);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // container for session rows
    this._rowsBox = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._rowsBox);
    this._rowItems = [];

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // footer actions
    const footerBox = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    const footerLabel = new St.Label({
      text: 'polling 127.0.0.1:4390  •  traffic-light doctor',
      style_class: 'traffic-row-reason',
      y_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    footerBox.actor.add_child(footerLabel);
    this._indicator.menu.addMenuItem(footerBox);
    this._footerLabel = footerLabel;
  }

  async _poll() {
    try {
      const msg = Soup.Message.new('GET', STATUS_URL);
      if (this._token) msg.get_request_headers().append('x-traffic-token', this._token);
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.get_status() !== Soup.Status.OK) {
        if (msg.get_status() === 401) this._footerLabel.text = 'unauthorized — check token';
        else this._footerLabel.text = `http ${msg.get_status()}`;
        this._lastOk = false;
        return;
      }
      const text = new TextDecoder().decode(bytes.get_data());
      const data = JSON.parse(text);
      const ag = data.aggregate || data.state || 'green';
      const sessions = data.sessions || [];
      this._aggregate = ag;
      this._sessions = sessions;
      this._lastOk = true;
      this._updatePill(ag, false);
      this._updateMenu(sessions, ag);
      this._footerLabel.text = `${sessions.length} session${sessions.length !== 1 ? 's' : ''} • ${ag}`;
    } catch (e) {
      this._lastOk = false;
      this._footerLabel.text = 'server not running — start an opencode TUI';
      // keep last pill but dim via opacity handled in updatePill
      this._updatePill(this._aggregate, true);
    }
  }

  _updatePill(aggregate, isOffline) {
    for (const c of ['red', 'yellow', 'green']) {
      const dot = this._dots[c];
      dot.remove_style_class_name('active');
      dot.set_style(null);
    }
    this._pill.remove_style_class_name('error-pulse');
    this._pill.remove_style_class_name('offline');
    this._pill.set_style(null);
    this._pill.opacity = isOffline ? 110 : 255;

    const colors = this._config?.colors || DEFAULT_CONFIG.colors;
    const sizes = this._config?.sizes || DEFAULT_CONFIG.sizes;
    const pillInline = `spacing: ${sizes.spacing}px; padding: ${sizes.pillPaddingV}px ${sizes.pillPaddingH}px; border-width: ${sizes.borderWidth}px; min-height: ${sizes.pillHeight}px; background-color: rgba(18,18,20,0.88);`;
    this._pill.set_style(pillInline);

    const isError = aggregate === 'error';
    const active = isError ? 'red' : aggregate;
    const dot = this._dots[active] || this._dots.green;
    dot.add_style_class_name('active');
    if (isError) dot.add_style_class_name('error');
    const hex = isError ? (colors.error || DEFAULT_CONFIG.colors.error) : (colors[active] || DEFAULT_CONFIG.colors[active]);
    if (dot) dot.set_style(`background-color: ${hex}; box-shadow: inset 0 1px 1px rgba(255,255,255,0.32), 0 0 8px 1.8px ${hex}e0, 0 0 18px 4px ${hex}38;`);

    if (isError) this._pill.add_style_class_name('error-pulse');
    if (isOffline) this._pill.add_style_class_name('offline');

    const label = this._lastOk ? `${aggregate}` : `${aggregate} (offline)`;
    this._indicator.tooltip_text = label;
  }

  _updateMenu(sessions, aggregate) {
    for (const it of this._rowItems) it.destroy();
    this._rowItems = [];

    if (!sessions.length) {
      const empty = new PopupMenu.PopupMenuItem('no active sessions', { reactive: false });
      empty.sensitive = false;
      this._rowsBox.addMenuItem(empty);
      this._rowItems.push(empty);
      return;
    }

    const sorted = [...sessions].sort((a, b) => {
      const pri = { error: 4, red: 3, yellow: 2, green: 1 };
      return (pri[b.color] || 0) - (pri[a.color] || 0) || a.since - b.since;
    });

    for (const s of sorted) {
      const item = new PopupMenu.PopupBaseMenuItem();
      const row = new St.BoxLayout({ style_class: `traffic-row ${s.stale ? 'stale' : ''}`, x_expand: true });

      const dot = new St.Widget({
        style_class: 'traffic-row-dot',
        style: `background-color: ${this._colorHex(s.color)}; ${s.color !== 'green' ? 'box-shadow: 0 0 6px ' + this._colorHex(s.color) + ';' : ''}`,
        y_align: Clutter.ActorAlign.CENTER,
      });

      const mid = new St.BoxLayout({ vertical: true, x_expand: true });
      const top = new St.BoxLayout({ x_expand: true });
      const cwdLabel = new St.Label({ text: shortCwd(s.cwd), style_class: 'traffic-row-cwd', x_expand: true });
      const timeLabel = new St.Label({ text: fmtElapsed(Date.now() - s.since), style_class: 'traffic-row-time' });
      // store refs for ticker
      item._timeLabel = timeLabel;
      item._since = s.since;
      item._stale = s.stale;

      top.add_child(cwdLabel);
      top.add_child(timeLabel);

      const reasonLabel = new St.Label({ text: `${s.reason}${s.stale ? ' • stale' : ''}`, style_class: 'traffic-row-reason' });

      mid.add_child(top);
      mid.add_child(reasonLabel);

      row.add_child(dot);
      row.add_child(mid);
      item.actor.add_child(row);

      // Clipboard on user activate — copies cwd, manual_review approved
      item.connect('activate', () => {
        const focused = this._tryFocusWindow(s.cwd);
        try {
          if (s.cwd) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, s.cwd);
        } catch {}
        if (focused) this._indicator.menu.close();
      });

      this._rowsBox.addMenuItem(item);
      this._rowItems.push(item);
    }
  }

  _tryFocusWindow(cwd) {
    if (!cwd || cwd === 'global') return false;
    try {
      const display = global.display;
      if (!display) return false;
      const windows = display.get_tab_list ? display.get_tab_list(Meta.TabList.NORMAL_ALL, null) : [];
      if (!windows?.length) return false;
      const base = cwd.split('/').filter(Boolean).pop() || cwd;
      let best = null, bestScore = -1;
      for (const w of windows) {
        try {
          const title = w.get_title?.() || '';
          const pid = w.get_pid?.() || 0;
          let score = -1;
          if (pid > 0) {
            try {
              const link = GLib.file_read_link(`/proc/${pid}/cwd`, null);
              if (link === cwd) score = 10;
              else if (link && link.includes(base)) score = 3;
              else if (title.includes(base)) score = 2;
            } catch {}
          } else if (title.includes(base)) score = 2;
          if (score > bestScore) { bestScore = score; best = w; }
        } catch {}
      }
      if (best && bestScore >= 1) {
        try { Main.activateWindow(best); return true; } catch {}
        try { best.activate(global.get_current_time()); return true; } catch {}
        try { best.raise(); return true; } catch {}
      }
    } catch {}
    return false;
  }

  _refreshElapsed() {
    for (const it of this._rowItems) {
      if (it._timeLabel && it._since) {
        it._timeLabel.text = fmtElapsed(Date.now() - it._since);
      }
    }
  }

  _colorHex(c) {
    const cfgColors = this._config?.colors || DEFAULT_CONFIG.colors;
    if (cfgColors[c]) return cfgColors[c];
    return DEFAULT_CONFIG.colors[c] || 'rgba(255,255,255,0.3)';
  }
}
