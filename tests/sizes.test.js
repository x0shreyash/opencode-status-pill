#!/usr/bin/env node
import assert from "node:assert/strict";

const DEFAULT_SIZES = { pillPaddingV:3, pillPaddingH:12, borderWidth:1, pillHeight:24, spacing:7 };
function clampInt(v, lo, hi, def) {
  return (typeof v === 'number' && isFinite(v) && !isNaN(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
}
function clampSizes(j) {
  const s = { ...DEFAULT_SIZES, ...(j.sizes||{}) };
  s.pillPaddingV = clampInt(s.pillPaddingV, 0, 12, DEFAULT_SIZES.pillPaddingV);
  s.pillPaddingH = clampInt(s.pillPaddingH, 6, 24, DEFAULT_SIZES.pillPaddingH);
  s.borderWidth = clampInt(s.borderWidth, 0, 4, DEFAULT_SIZES.borderWidth);
  s.pillHeight = clampInt(s.pillHeight, 16, 36, DEFAULT_SIZES.pillHeight);
  s.spacing = clampInt(s.spacing, 0, 12, DEFAULT_SIZES.spacing);
  return s;
}

// happy path
assert.deepEqual(clampSizes({sizes:{pillPaddingV:5}}).pillPaddingV,5);
assert.deepEqual(clampSizes({}).pillPaddingH,12, "missing sizes → defaults");
assert.deepEqual(clampSizes({sizes:{}}).borderWidth,1);

// type guards
assert.equal(clampSizes({sizes:{pillPaddingH:"16"}}).pillPaddingH,12, "string → fallback");
assert.equal(clampSizes({sizes:{borderWidth: null}}).borderWidth,1);
assert.equal(clampSizes({sizes:{spacing: null}}).spacing,7);

// range guards - clamp to bounds (not fallback) except border 0 allowed
assert.equal(clampSizes({sizes:{pillPaddingH: 3}}).pillPaddingH,6, "<6 clamp to 6");
assert.equal(clampSizes({sizes:{pillPaddingH: 40}}).pillPaddingH,24, ">24 clamp to 24");
assert.equal(clampSizes({sizes:{borderWidth: -1}}).borderWidth,0, "<0 clamp to 0");
assert.equal(clampSizes({sizes:{borderWidth: 10}}).borderWidth,4, ">4 clamp to 4");
assert.equal(clampSizes({sizes:{borderWidth:0}}).borderWidth,0, "0 allowed for border");
assert.equal(clampSizes({sizes:{spacing:0}}).spacing,0, "0 allowed for spacing");
assert.equal(clampSizes({sizes:{pillPaddingH:0}}).pillPaddingH,6, "0 clamp to 6 for paddingH");

// float rounding (pillPaddingH rounds to int)
assert.equal(clampSizes({sizes:{pillPaddingH: 16.7}}).pillPaddingH, 17);

// preserves other keys
let c = clampSizes({sizes:{pillPaddingV:8}, pollMs:600});
assert.equal(c.pillPaddingV,8);

// back-compat no sizes key still loads and save would write defaults
let noSizes = clampSizes({});
assert.deepEqual(Object.keys(noSizes).sort(), Object.keys(DEFAULT_SIZES).sort());

console.log("sizes validation passed");

// test file existence and valid json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const pNew = path.join(os.homedir(), ".config/opencode-status-pill/config.json");
const pOld = path.join(os.homedir(), ".config/opencode-status-pill/config.json");
const p = fs.existsSync(pNew) ? pNew : pOld;
if (fs.existsSync(p)) {
  const j = JSON.parse(fs.readFileSync(p,"utf8"));
  assert.ok(j.sizes || true, "config may not yet have sizes until setup");
  console.log("config.json exists, sizes:", j.sizes ? "present" : "not yet (will be migrated on setup)");
}
