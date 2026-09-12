// traffic-light — opencode plugin
// Aggregates per-session state and serves at http://127.0.0.1:4390/status as {aggregate, sessions[]}
// Colors: error > red > yellow > green — first TUI owns port, others forward via POST /event
import { homedir } from "node:os";
import { join } from "node:path";
import * as fsSync from "node:fs";

const PORT = 4390;
const CONFIG_PATH = join(homedir(), ".config", "opencode-status-pill", "config.json");
const DEFAULT_CONFIG = {
  staleMs: 5 * 60 * 1000,
  colors: { red: "#ff453a", yellow: "#ffcc00", green: "#2ecc71", error: "#bf5af2" },
};
let staleTimeoutMs = DEFAULT_CONFIG.staleMs;

function loadConfig() {
  try {
    if (fsSync.existsSync(CONFIG_PATH)) {
      const raw = fsSync.readFileSync(CONFIG_PATH, "utf8");
      const j = JSON.parse(raw);
      if (typeof j.staleMs === "number" && j.staleMs > 1000) staleTimeoutMs = j.staleMs;
      if (typeof j.staleTimeoutMs === "number" && j.staleTimeoutMs > 1000) staleTimeoutMs = j.staleTimeoutMs;
      return { staleMs: staleTimeoutMs, colors: { ...DEFAULT_CONFIG.colors, ...(j.colors || {}) } };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}
loadConfig();

const TOKEN_PATH = join(homedir(), ".config", "opencode-status-pill", "token");

const states = new Map();
const histories = new Map(); // sid -> Array<{at:number,color:string,reason:string}>
const HISTORY_LIMIT = 10;
let startedAt = Date.now();
let serving = false;
let lastStructuredAt = 0;

function pushHistory(sid, color, reason, cwd) {
  let h = histories.get(sid);
  if (!h) { h = []; histories.set(sid, h); }
  h.push({ at: nowMs(), color, reason: reason || color, cwd });
  if (h.length > HISTORY_LIMIT) h.shift();
}

function getHistory(sid) {
  return histories.get(sid) || [];
}

function nowMs() { return Date.now(); }

function priorityOf(c) {
  if (c === "error") return 4;
  if (c === "red") return 3;
  if (c === "yellow") return 2;
  return 1; // green
}

function aggregate() {
  let best = "green";
  let bestPri = 1;
  for (const s of states.values()) {
    const p = priorityOf(s.color);
    if (p > bestPri) { best = s.color; bestPri = p; }
    if (best === "error") return "error";
  }
  return best;
}

function getToken() {
  try {
    if (fsSync.existsSync(TOKEN_PATH)) return fsSync.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {}
  return null;
}

function toPublicSession(s, includeHistory = false) {
  const stale = nowMs() - s.lastEvent > staleTimeoutMs && (s.color === "yellow" || s.color === "red" || s.color === "error");
  const out = {
    sid: s.sid,
    color: s.color,
    reason: s.reason,
    since: s.since,
    lastEvent: s.lastEvent,
    cwd: s.cwd,
    sessionTitle: s.sessionTitle,
    stale,
  };
  if (includeHistory) out.history = getHistory(s.sid).slice(-HISTORY_LIMIT);
  return out;
}

function sidOf(event) {
  const p = event.properties || {};
  return p.sessionID || p.sessionId || (p.session && p.session.id) || (p.info && p.info.id) || "global";
}

function cwdOf(event) {
  const p = event.properties || {};
  return p.directory || p.cwd || (p.info && p.info.directory) || (p.session && p.session.directory) || undefined;
}

function titleOf(event) {
  const p = event.properties || {};
  return p.title || (p.info && p.info.title) || (p.session && p.session.title) || undefined;
}

function statusColor(s) {
  if (s && typeof s === "object") s = String(s.type || s.status || "");
  s = String(s || "").toLowerCase();
  if (/wait|permission|ask|approval|blocked/.test(s)) return "red";
  if (/busy|work|run|active|processing|retry/.test(s)) return "yellow";
  if (/idle|done|complete|finish|compact/.test(s)) return "green";
  return null;
}

function typedStatusColor(status) {
  if (!status) return null;
  let kind = typeof status === "string" ? status : status.type || status.status || "";
  kind = String(kind).toLowerCase();
  if (kind === "idle") return "green";
  if (kind === "busy" || kind === "retry" || kind === "pending" || kind === "running" || kind === "streaming" || kind === "working" || kind === "active") return "yellow";
  return statusColor(kind);
}

async function forward(payload) {
  try {
    const token = getToken();
    const headers = { "content-type": "application/json" };
    if (token) headers["x-traffic-token"] = token;
    await fetch(`http://127.0.0.1:${PORT}/event`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // server gone; next event retries serve
  }
}

let serverInstance = null;

function ensureServer() {
  if (serving && serverInstance) return true;
  try {
    serverInstance = Bun.serve({
      port: PORT,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/health") {
          const cfg = loadConfig();
          return Response.json({ ok: true, serving: true, sessions: states.size, uptime: nowMs() - startedAt, aggregate: aggregate(), config: { staleMs: cfg.staleMs } });
        }

        if (req.method === "POST" && url.pathname === "/event") {
          try {
            if (fsSync.existsSync(TOKEN_PATH)) {
              const tok = fsSync.readFileSync(TOKEN_PATH, "utf8").trim();
              if (tok) {
                const hdr = req.headers.get("x-traffic-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
                if (hdr !== tok) return new Response("unauthorized", { status: 401 });
              }
            }
          } catch {}
          let b;
          try { b = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
          if (!b || !b.sid) return Response.json({ ok: false }, { status: 400 });
          if (b._delete === true || b.color === "__delete__" || b.state === "__delete__") {
            states.delete(b.sid);
            histories.delete(b.sid);
            return Response.json({ ok: true, deleted: true });
          }
          const sid = b.sid || "global";
          const color = b.state || b.color || "green";
          const rec = states.get(sid);
          const ts = b.lastEvent || b.since || nowMs();
          if (rec) {
            if (rec.color === "error" && color === "green" && !b.force) {
              rec.lastEvent = nowMs();
              if (b.cwd) rec.cwd = b.cwd;
              if (b.sessionTitle) rec.sessionTitle = b.sessionTitle;
              return Response.json({ ok: true, ignored: "error persists" });
            }
            const colorChanged = rec.color !== color;
            rec.color = color;
            rec.reason = b.reason || b.state || rec.reason;
            rec.lastEvent = nowMs();
            if (colorChanged) {
              rec.since = ts;
              pushHistory(sid, color, b.reason || color, b.cwd || rec.cwd);
            }
            if (b.cwd) rec.cwd = b.cwd;
            if (b.sessionTitle) rec.sessionTitle = b.sessionTitle;
          } else {
            states.set(sid, {
              sid,
              color,
              reason: b.reason || color,
              since: b.since || nowMs(),
              lastEvent: b.lastEvent || nowMs(),
              cwd: b.cwd,
              sessionTitle: b.sessionTitle,
            });
            pushHistory(sid, color, b.reason || color, b.cwd);
          }
          return Response.json({ ok: true });
        }

        if (url.pathname === "/history") {
          const sidQ = url.searchParams.get("sid");
          if (!sidQ) return Response.json({ error: "missing sid" }, { status: 400 });
          const h = getHistory(sidQ);
          return Response.json({ sid: sidQ, history: h });
        }

        if (url.pathname === "/status" || url.pathname === "/status/") {
          const cfg = loadConfig();
          const includeHistory = url.searchParams.get("history") === "1" || url.searchParams.get("history") === "true";
          const sidQ = url.searchParams.get("sid");
          const ag = aggregate();
          if (sidQ) {
            const s = states.get(sidQ);
            if (!s) return Response.json({ aggregate: ag, session: null }, { status: 404 });
            return Response.json({ aggregate: ag, session: toPublicSession(s, includeHistory) });
          }
          const sessions = Array.from(states.values()).map(s => toPublicSession(s, includeHistory));
          sessions.sort((a, b) => priorityOf(b.color) - priorityOf(a.color) || a.since - b.since);
          return Response.json({ aggregate: ag, state: ag, sessions, config: { staleMs: cfg.staleMs } });
        }

        const ag = aggregate();
        return Response.json({ state: ag, aggregate: ag });
      },
    });
    serving = true;
    startedAt = nowMs();
    return true;
  } catch {
    return false; // port taken
  }
}

async function setState(sid, color, reason, extra = {}) {
  sid = sid || "global";
  const ts = nowMs();
  const rec = states.get(sid);

  if (rec) {
    if (rec.color === "error" && color === "green" && !extra.force) {
      // only heartbeat, don't downgrade error
      rec.lastEvent = ts;
      if (extra.cwd) rec.cwd = extra.cwd;
      if (extra.sessionTitle) rec.sessionTitle = extra.sessionTitle;
    } else {
      const colorChanged = rec.color !== color;
      rec.color = color;
      rec.reason = reason || rec.reason;
      rec.lastEvent = ts;
      if (colorChanged) {
        rec.since = ts;
        pushHistory(sid, color, reason || color, extra.cwd || rec.cwd);
      }
      if (extra.cwd) rec.cwd = extra.cwd;
      if (extra.sessionTitle) rec.sessionTitle = extra.sessionTitle;
    }
  } else {
    states.set(sid, {
      sid,
      color,
      reason: reason || color,
      since: ts,
      lastEvent: ts,
      cwd: extra.cwd,
      sessionTitle: extra.sessionTitle,
    });
    pushHistory(sid, color, reason || color, extra.cwd);
  }

  if (!ensureServer()) {
    const payload = {
      sid,
      state: color,
      color,
      reason: reason || color,
      since: rec ? rec.since : ts,
      lastEvent: ts,
      cwd: extra.cwd,
      sessionTitle: extra.sessionTitle,
    };
    if (extra.force) payload.force = true;
    await forward(payload);
  }
}

export const TrafficLightPlugin = async (ctx) => {
  try {
    const ok = ensureServer();
    if (ctx && ctx.client) {
      await ctx.client.app.log({
        body: {
          service: "traffic-light",
          level: "info",
          message: ok ? "serving state at http://127.0.0.1:4390/status" : "port taken, forwarding events to state server",
        },
      });
    }
  } catch {}

  return {
    event: async ({ event }) => {
      if (!event || !event.type) return;
      const sid = sidOf(event);
      const cwd = cwdOf(event);
      const title = titleOf(event);
      const p = event.properties || {};

      switch (event.type) {
        case "permission.asked":
        case "permission.v2.asked":
        case "question.asked":
        case "question.v2.asked": {
          lastStructuredAt = nowMs();
          const perm = p.permission || p.action || p.question || p.header || "permission";
          const pat = (p.patterns || p.resources || []).slice(0, 2).join(",");
          const reason = pat ? `${event.type}:${perm}:${pat}` : `${event.type}:${perm}`;
          await setState(sid, "red", reason, { cwd, sessionTitle: title });
          break;
        }
        case "permission.replied":
        case "permission.v2.replied":
        case "question.replied":
        case "question.v2.replied":
        case "question.rejected": {
          lastStructuredAt = nowMs();
          await setState(sid, "yellow", `${event.type}:${p.reply || p.action || "replied"}`, { cwd, sessionTitle: title });
          break;
        }
        case "session.created": {
          lastStructuredAt = nowMs();
          // force clear error on new session
          await setState(sid, "green", "session.created", { cwd: cwd || p.directory || (p.info && p.info.directory), sessionTitle: title || (p.info && p.info.title), force: true });
          break;
        }
        case "session.updated": {
          // update metadata without changing color (heartbeat)
          const rec = states.get(sid);
          if (rec) {
            rec.lastEvent = nowMs();
            if (cwd) rec.cwd = cwd;
            if (title) rec.sessionTitle = title;
            // also patch title/cwd from info if present
            if (p.info) {
              if (p.info.directory) rec.cwd = p.info.directory;
              if (p.info.title) rec.sessionTitle = p.info.title;
            }
          } else if (cwd || title) {
            await setState(sid, "green", "session.updated", { cwd: cwd || (p.info && p.info.directory), sessionTitle: title || (p.info && p.info.title) });
          }
          break;
        }
        case "session.deleted": {
          lastStructuredAt = nowMs();
          states.delete(sid);
          histories.delete(sid);
          // forward delete to server (if we are not the server)
          if (!serving) {
            try {
              const token = getToken();
              const headers = { "content-type": "application/json" };
              if (token) headers["x-traffic-token"] = token;
              await fetch(`http://127.0.0.1:${PORT}/event`, {
                method: "POST",
                headers,
                body: JSON.stringify({ sid, _delete: true }),
              });
            } catch {}
          }
          break;
        }
        case "session.error": {
          lastStructuredAt = nowMs();
          const err = p.error || p.err || {};
          const msg = err.data?.message || err.message || String(err.name || "session.error");
          await setState(sid, "error", `error:${msg.slice(0,120)}`, { cwd, sessionTitle: title });
          break;
        }
        case "session.idle": {
          lastStructuredAt = nowMs();
          const rec = states.get(sid);
          if (rec && rec.color === "error") {
            rec.lastEvent = nowMs(); // heartbeat only
          } else {
            await setState(sid, "green", "session.idle", { cwd, sessionTitle: title });
          }
          break;
        }
        case "session.compacted":
        case "session.status": {
          // secondary signal — don't override recent structured red/error
          const sinceStructured = nowMs() - lastStructuredAt;
          if (sinceStructured < 800) break; // structured wins on tie
          let c = null;
          const st = p.status || p.state || p.sessionStatus;
          if (st) c = typedStatusColor(st);
          else c = statusColor(p.status);
          if (!c) break;
          // don't downgrade error/red to green/yellow via status alone if already red/error
          const rec = states.get(sid);
          if (rec && (rec.color === "red" || rec.color === "error") && (c === "green" || c === "yellow")) {
            rec.lastEvent = nowMs();
            break;
          }
          await setState(sid, c, `status:${String(st?.type || st || p.status).slice(0,40)}`, { cwd, sessionTitle: title });
          break;
        }
        case "message.updated": {
          const role = p.role || (p.info && p.info.role);
          if (role === "assistant") {
            lastStructuredAt = nowMs();
            await setState(sid, "yellow", "assistant_msg", { cwd, sessionTitle: title });
          }
          break;
        }
        case "session.next.step.started":
        case "session.next.tool.called": {
          lastStructuredAt = nowMs();
          await setState(sid, "yellow", `tool:${p.tool || "unknown"}`, { cwd, sessionTitle: title });
          break;
        }
      }
    },
    "tool.execute.before": async (input) => {
      const sid = (input && (input.sessionID || input.sessionId)) || "global";
      const tool = (input && input.tool) || "";
      lastStructuredAt = nowMs();
      const isQuestion = /question|ask|input|prompt|confirm/i.test(tool);
      await setState(sid, isQuestion ? "red" : "yellow", `tool:${tool || "unknown"}`, {});
    },
    "tool.execute.after": async (input) => {
      const sid = (input && (input.sessionID || input.sessionId)) || "global";
      const tool = (input && input.tool) || "";
      if (/question|ask|input|prompt|confirm/i.test(tool)) {
        lastStructuredAt = nowMs();
        await setState(sid, "yellow", `tool:${tool}:done`, {});
      }
    },
  };
};

export default TrafficLightPlugin;
