/*
 * PROTOTYPE self-check — run: node .scratch/multiplayer-rooms/prototype/verify.cjs
 *
 * A browser engine is not installed in this environment, and adding one as a project
 * dependency just to smoke-test a throwaway file would be disproportionate. This does
 * the two checks that actually catch things:
 *   1. Both scripts parse.
 *   2. Every element id the page script reaches for exists in the markup, and every
 *      RoomProto function it calls exists on the API. (A typo'd id is the classic way
 *      one of these files dies with "Cannot read properties of null".)
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'room-state.html'), 'utf8');
const logicSrc = fs.readFileSync(path.join(dir, 'room-state.js'), 'utf8');

let failures = 0;
const fail = (m) => { console.error('  ✖ ' + m); failures += 1; };
const pass = (m) => console.log('  ✔ ' + m);

// 1. Both scripts parse, and the logic file exposes its API.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(logicSrc, sandbox);
const API = sandbox.RoomProto;
API ? pass('room-state.js parses and exposes RoomProto') : fail('room-state.js did not expose RoomProto');

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).join('\n');
try {
  new vm.Script(inline, { filename: 'room-state.html<script>' });
  pass('inline page script parses');
} catch (e) {
  fail('inline page script is a syntax error: ' + e.message);
}

// 2. The <script src> the page depends on is actually next to it.
const src = /<script[^>]*\bsrc="([^"]+)"/.exec(html);
if (!src) fail('page does not load room-state.js');
else if (!fs.existsSync(path.join(dir, src[1]))) fail(`page loads missing file ${src[1]}`);
else pass(`page loads ${src[1]}, which exists alongside it`);

// 3. Every id the script reaches for exists in the markup.
const declaredIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = [...inline.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
const missingIds = [...new Set(usedIds)].filter((id) => !declaredIds.has(id));
missingIds.length
  ? fail('script reaches for ids that do not exist: ' + missingIds.join(', '))
  : pass(`all ${new Set(usedIds).size} referenced element ids exist`);

// 4. Every RoomProto member the page calls exists on the API.
const usedApi = [...new Set([...inline.matchAll(/\bR\.([A-Za-z_]\w*)/g)].map((m) => m[1]))];
const missingApi = usedApi.filter((k) => !(k in API));
missingApi.length
  ? fail('page calls RoomProto members that do not exist: ' + missingApi.join(', '))
  : pass(`all ${usedApi.length} RoomProto members used by the page exist`);

// 5. Every scenario runs end to end without throwing, and produces a sane leaderboard.
const prelude = inline.slice(0, inline.indexOf('function reset()'));
const scenarioBox = { window: { RoomProto: API } };
vm.createContext(scenarioBox);
vm.runInContext(prelude + '\nglobalThis.__S = SCENARIOS;', scenarioBox);
const scenarios = scenarioBox.__S;

pass(`${scenarios.length} guided walkthroughs defined`);

for (const s of scenarios) {
  const room = API.createRoom({ code: 'PLAY', letter: 'S' });
  try {
    for (const [, fn] of s.steps) fn(room);
  } catch (e) {
    fail(`"${s.title}" threw on step: ${e.message}`);
    continue;
  }

  const rows = room.results ? room.results.rows : [];
  const ranksOk = rows.every((r) => Number.isInteger(r.rank) && r.rank >= 1);
  const scoresOk = rows.every((r) => Number.isFinite(r.totalScore) && r.totalScore >= 0);
  const sortedOk = rows.every((r, i) => i === 0 || rows[i - 1].totalScore >= r.totalScore);

  if (!ranksOk || !scoresOk || !sortedOk) {
    fail(`"${s.title}" produced a malformed leaderboard`);
  } else {
    const summary = rows.length
      ? rows.map((r) => `${r.rank}. ${r.name} ${r.totalScore}`).join(' | ')
      : `no round scored (phase ${room.phase}${room.closed ? ', closed' : ''})`;
    pass(`"${s.title}" — ${summary}`);
  }
}

// 6. The scoring constants have not drifted from the real ones.
const scoringTs = fs.readFileSync(
  path.join(dir, '..', '..', '..', 'src', 'server', 'referee', 'scoring.ts'),
  'utf8'
);
const realTiers = [...scoringTs.matchAll(/maxSeconds:\s*(\d+),\s*bonus:\s*(\d+)/g)]
  .map((m) => `${m[1]}:${m[2]}`).join(',');
const protoTiers = API.SCORING.speedTiers.map((t) => `${t.maxSeconds}:${t.bonus}`).join(',');
realTiers === protoTiers
  ? pass('speed ladder matches src/server/referee/scoring.ts')
  : fail(`speed ladder drifted — real ${realTiers} vs prototype ${protoTiers}`);

for (const [key, re] of [['validAnswer', /validAnswer:\s*(\d+)/], ['validAnswerWithBonus', /validAnswerWithBonus:\s*(\d+)/]]) {
  const real = Number(re.exec(scoringTs)[1]);
  real === API.SCORING[key]
    ? pass(`${key} matches the real scoring (${real})`)
    : fail(`${key} drifted — real ${real} vs prototype ${API.SCORING[key]}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
