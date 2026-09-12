#!/usr/bin/env node
// pure-function tests for v2 state model — no live opencode needed
import assert from "node:assert/strict";

function priorityOf(c) {
  if (c === "error") return 4;
  if (c === "red") return 3;
  if (c === "yellow") return 2;
  return 1;
}
function aggregate(sessions) {
  let best = "green";
  let bestPri = 1;
  for (const s of sessions) {
    const p = priorityOf(s.color);
    if (p > bestPri) { best = s.color; bestPri = p; }
    if (best === "error") return "error";
  }
  return best;
}
function isStale(s, now, timeout = 5*60*1000) {
  return now - s.lastEvent > timeout && (s.color === "yellow" || s.color === "red" || s.color === "error");
}

// --- aggregate priority: error > red > yellow > green ---
assert.equal(aggregate([{color:"green"},{color:"green"}]), "green", "all green");
assert.equal(aggregate([{color:"green"},{color:"yellow"}]), "yellow", "yellow beats green");
assert.equal(aggregate([{color:"yellow"},{color:"red"}]), "red", "red beats yellow");
assert.equal(aggregate([{color:"red"},{color:"error"}]), "error", "error beats red");
assert.equal(aggregate([{color:"green"},{color:"yellow"},{color:"red"},{color:"error"}]), "error", "error wins overall");
assert.equal(aggregate([{color:"green"},{color:"red"},{color:"yellow"}]), "red", "red wins over yellow");
assert.equal(aggregate([]), "green", "empty -> green");
assert.equal(aggregate([{color:"green"},{color:"green"},{color:"yellow"}]), "yellow", "any yellow");

// --- stale detection ---
const now = Date.now();
assert.equal(isStale({color:"yellow", lastEvent: now - 1000}, now), false, "yellow recent not stale");
assert.equal(isStale({color:"yellow", lastEvent: now - 6*60*1000}, now), true, "yellow old stale");
assert.equal(isStale({color:"red", lastEvent: now - 6*60*1000}, now), true, "red old stale");
assert.equal(isStale({color:"error", lastEvent: now - 6*60*1000}, now), true, "error old stale");
assert.equal(isStale({color:"green", lastEvent: now - 10*60*1000}, now), false, "green never stale even if old");
assert.equal(isStale({color:"yellow", lastEvent: now - 299000}, now), false, "just under 5m not stale");
assert.equal(isStale({color:"yellow", lastEvent: now - 301000}, now), true, "just over 5m stale");

// --- error persistence: green should not overwrite error ---
let rec = { color:"error", since: now-1000, lastEvent: now-1000 };
function setState(rec, newColor, force=false) {
  if (rec.color==="error" && newColor==="green" && !force) return rec.color; // heartbeat only
  return newColor;
}
assert.equal(setState(rec,"green",false), "error", "error persists against green");
assert.equal(setState(rec,"green",true), "green", "force clears error");
assert.equal(setState(rec,"yellow",false), "yellow", "error can go to yellow");
assert.equal(setState({color:"yellow", since:0, lastEvent:0},"green",false), "green", "yellow to green allowed");

console.log("all aggregate + stale tests passed");
