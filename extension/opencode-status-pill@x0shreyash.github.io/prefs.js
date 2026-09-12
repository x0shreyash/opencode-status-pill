import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CONFIG_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'config.json']);
const DEFAULTS = {
  pollMs: 500,
  staleMs: 300000,
  colors: { red: "#ff453a", yellow: "#ffcc00", green: "#2ecc71", error: "#bf5af2" },
  sizes: { pillPaddingV: 3, pillPaddingH: 12, borderWidth: 1, pillHeight: 24, spacing: 7 },
};

function loadConfig() {
  try {
    const f = Gio.File.new_for_path(CONFIG_PATH);
    if (f.query_exists(null)) {
      const [ok, bytes] = f.load_contents(null);
      if (ok) {
        const j = JSON.parse(new TextDecoder().decode(bytes));
        const cfg = { ...DEFAULTS, ...j, colors: { ...DEFAULTS.colors, ...(j.colors || {}) }, sizes: { ...DEFAULTS.sizes, ...(j.sizes || {}) } };
        // clamp sizes — 5 keys (pill geometry only)
        const SZ = DEFAULTS.sizes;
        const clampInt = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) && !isNaN(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
        cfg.sizes.pillPaddingV = clampInt(cfg.sizes.pillPaddingV, 0, 12, SZ.pillPaddingV);
        cfg.sizes.pillPaddingH = clampInt(cfg.sizes.pillPaddingH, 6, 24, SZ.pillPaddingH);
        cfg.sizes.borderWidth = clampInt(cfg.sizes.borderWidth, 0, 4, SZ.borderWidth);
        cfg.sizes.pillHeight = clampInt(cfg.sizes.pillHeight, 16, 36, SZ.pillHeight);
        cfg.sizes.spacing = clampInt(cfg.sizes.spacing, 0, 12, SZ.spacing);
        // drop legacy iconSize/fontSize if present
        if ('iconSize' in cfg.sizes) delete cfg.sizes.iconSize;
        if ('fontSize' in cfg.sizes) delete cfg.sizes.fontSize;
        return cfg;
      }
    }
  } catch {}
  return { ...DEFAULTS, colors: { ...DEFAULTS.colors }, sizes: { ...DEFAULTS.sizes } };
}

function saveConfig(cfg) {
  try {
    const f = Gio.File.new_for_path(CONFIG_PATH);
    const dir = f.get_parent();
    if (!dir.query_exists(null)) dir.make_directory_with_parents(null);
    const data = JSON.stringify(cfg, null, 2);
    f.replace_contents(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
  } catch (e) {
    console.error(`traffic-light prefs save failed: ${e}`);
  }
}

function hexToRgba(hex) {
  const rgba = new Gdk.RGBA();
  rgba.parse(hex);
  return rgba;
}

export default class TrafficLightPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const cfg = loadConfig();

    const page = new Adw.PreferencesPage({ title: 'Traffic Light', icon_name: 'preferences-system-symbolic' });
    window.add(page);

    const timing = new Adw.PreferencesGroup({ title: 'Timing' });
    page.add(timing);

    const pollRow = new Adw.SpinRow({
      title: 'Poll interval',
      subtitle: 'Poll 127.0.0.1:4390 (ms).',
      adjustment: new Gtk.Adjustment({ lower: 200, upper: 2000, step_increment: 50, value: cfg.pollMs }),
    });
    pollRow.connect('notify::value', () => {
      cfg.pollMs = Math.round(pollRow.get_value());
      saveConfig(cfg);
    });
    timing.add(pollRow);

    const staleRow = new Adw.SpinRow({
      title: 'Stale timeout',
      subtitle: 'Stale after ms without heartbeat.',
      adjustment: new Gtk.Adjustment({ lower: 30000, upper: 600000, step_increment: 30000, value: cfg.staleMs }),
    });
    staleRow.connect('notify::value', () => {
      cfg.staleMs = Math.round(staleRow.get_value());
      saveConfig(cfg);
    });
    timing.add(staleRow);

    const colors = new Adw.PreferencesGroup({ title: 'Colors' });
    page.add(colors);

    for (const [key, label] of [['red','Red — needs you'], ['yellow','Yellow — working'], ['green','Green — idle'], ['error','Error — magenta']]) {
      const row = new Adw.ActionRow({ title: label, subtitle: cfg.colors[key] });
      const btn = new Gtk.ColorButton({ rgba: hexToRgba(cfg.colors[key] || DEFAULTS.colors[key]), use_alpha: false });
      btn.set_valign(Gtk.Align.CENTER);
      btn.connect('color-set', () => {
        const rgba = btn.get_rgba();
        const hex = `#${Math.round(rgba.red*255).toString(16).padStart(2,'0')}${Math.round(rgba.green*255).toString(16).padStart(2,'0')}${Math.round(rgba.blue*255).toString(16).padStart(2,'0')}`;
        cfg.colors[key] = hex;
        row.set_subtitle(hex);
        saveConfig(cfg);
      });
      row.add_suffix(btn);
      row.activatable_widget = btn;
      colors.add(row);
    }

    const sizes = new Adw.PreferencesGroup({ title: 'Sizes' });
    page.add(sizes);

    const sizeDefs = [
      { key: 'pillPaddingV', title: 'Vertical padding', subtitle: 'Top/bottom (px). Default 3.', lower: 0, upper: 12, step: 1 },
      { key: 'pillPaddingH', title: 'Horizontal padding', subtitle: 'Left/right (px). Default 12.', lower: 6, upper: 24, step: 1 },
      { key: 'borderWidth', title: 'Border width', subtitle: 'Border (px). Default 1.', lower: 0, upper: 4, step: 1 },
      { key: 'pillHeight', title: 'Pill height', subtitle: 'Min-height (px). Default 24.', lower: 16, upper: 36, step: 1 },
      { key: 'spacing', title: 'Dot spacing', subtitle: 'Gap between dots (px). Default 7.', lower: 0, upper: 12, step: 1 },
    ];
    for (const def of sizeDefs) {
      const adj = new Gtk.Adjustment({ lower: def.lower, upper: def.upper, step_increment: def.step, value: cfg.sizes[def.key] });
      const row = new Adw.SpinRow({ title: def.title, subtitle: def.subtitle, adjustment: adj });
      row.connect('notify::value', () => {
        cfg.sizes[def.key] = Math.round(row.get_value());
        saveConfig(cfg);
      });
      sizes.add(row);
    }
    const sizesHint = new Adw.ActionRow({ title: 'Reset sizes to defaults', subtitle: 'Sets 3/12/1/24/7' });
    const resetBtn = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
    resetBtn.connect('clicked', () => {
      cfg.sizes = { ...DEFAULTS.sizes };
      saveConfig(cfg);
      // update UI rows to reflect reset (re-read and set)
      for (const child of sizes.get_rows()) {
        if (child instanceof Adw.SpinRow) {
          const title = child.get_title();
          const def = sizeDefs.find(d => d.title === title);
          if (def) child.set_value(cfg.sizes[def.key]);
        }
      }
    });
    sizesHint.add_suffix(resetBtn);
    sizesHint.activatable_widget = resetBtn;
    sizes.add(sizesHint);

    const info = new Adw.PreferencesGroup({ title: 'Files' });
    page.add(info);

    const tokenRow = new Adw.ActionRow({ title: 'Token', subtitle: GLib.build_filenamev([GLib.get_home_dir(), '.config', 'opencode-status-pill', 'token']) });
    const tokenBtn = new Gtk.Button({ label: 'Copy path', valign: Gtk.Align.CENTER });
    tokenBtn.connect('clicked', () => {
      const clipboard = tokenBtn.get_display().get_clipboard();
      clipboard.set_content(Gdk.ContentProvider.new_for_value(tokenRow.get_subtitle()));
    });
    tokenRow.add_suffix(tokenBtn);
    info.add(tokenRow);

    const configRow = new Adw.ActionRow({ title: 'Config', subtitle: CONFIG_PATH });
    const openBtn = new Gtk.Button({ label: 'Open folder', valign: Gtk.Align.CENTER });
    openBtn.connect('clicked', () => {
      Gio.AppInfo.launch_default_for_uri(`file://${GLib.path_get_dirname(CONFIG_PATH)}`, null);
    });
    configRow.add_suffix(openBtn);
    info.add(configRow);

    window.set_default_size(640, 620);
  }
}
