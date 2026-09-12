import assert from "node:assert/strict";

const HISTORY_LIMIT = 10;
const histories = new Map();
function pushHistory(sid, color, reason) {
  let h = histories.get(sid);
  if (!h) { h = []; histories.set(sid, h); }
  h.push({ at: Date.now(), color, reason });
  if (h.length > HISTORY_LIMIT) h.shift();
}

pushHistory("s1", "green", "init");
pushHistory("s1", "yellow", "tool:bash");
pushHistory("s1", "red", "permission");
assert.equal(histories.get("s1").length, 3, "3 entries");
for (let i=0;i<10;i++) pushHistory("s1", "yellow", `run${i}`);
assert.equal(histories.get("s1").length, 10, "capped at 10");
assert.equal(histories.get("s1")[0].reason, "run0", "oldest evicted correctly");

pushHistory("s2", "green", "init");
assert.equal(histories.get("s2").length, 1, "separate sid");

histories.delete("s1");
assert.equal(histories.has("s1"), false, "delete clears");

console.log("history tests passed");
