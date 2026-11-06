import { mkdirSync, writeFileSync } from 'node:fs';
import { simulate } from '../tests/simulation-07';
const count = Number(process.env.SIM_COUNT || 500);
if (!Number.isInteger(count) || count < 200 || count > 10000)
  throw Error('SIM_COUNT must be 200..10000');
const summary = [];
mkdirSync('artifacts/balance-07', { recursive: true });
for (const q of [0, 0.25, 0.65, 0.9]) {
  const rows = Array.from({ length: count }, (_, i) => simulate(20001 + i, q));
  const sorted = rows.map((r) => r.round).sort((a, b) => a - b),
    pct = (n: number) => Number(((n / count) * 100).toFixed(2));
  const out = {
    recognitionAssumption: q,
    games: count,
    seeds: [20001, 20000 + count],
    meanRound: rows.reduce((s, r) => s + r.round, 0) / count,
    p90: sorted[Math.ceil(count * 0.9) - 1],
    earlyRound2: pct(rows.filter((r) => r.round <= 2).length),
    lateRound7: pct(rows.filter((r) => r.round >= 7).length),
    firstWin: pct(rows.filter((r) => r.winner === 'a').length),
    draw: pct(rows.filter((r) => r.winner === 'draw').length),
    guessWin: pct(rows.filter((r) => r.reason === 'activeGuess').length),
    pressureLoss: pct(rows.filter((r) => r.reason === 'pressureGuess').length),
    decisionTurns:
      rows.reduce((s, r) => s + r.decisionTurns, 0) /
      rows.reduce((s, r) => s + r.totalTurns, 0),
    eventIds: [...new Set(rows.flatMap((r) => r.eventIds))].sort(),
  };
  summary.push(out);
  writeFileSync(`artifacts/balance-07/raw-${q}.json`, JSON.stringify(rows));
  console.log(JSON.stringify(out));
}
writeFileSync(
  'artifacts/balance-07/summary.json',
  JSON.stringify(
    {
      note: 'Actual engine; synthetic complete song fixtures. Recognition and strategy are assumptions, not human balance or fun validation.',
      summary,
    },
    null,
    2,
  ),
);
