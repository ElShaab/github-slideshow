import { baseCardioMinutes } from '../src/services/cardioService';
const goalSets: Array<[string, any[]]> = [
  ['muscle_gain', ['muscle_gain']],
  ['fat_loss', ['fat_loss']],
  ['strength', ['strength']],
  ['general_fitness', ['general_fitness']],
  ['recomposition', ['recomposition']],
];
console.log('BF%   ' + goalSets.map(([n]) => n.padStart(16)).join(''));
for (const bf of [30, 27, 24, 21, 18, 15, 12]) {
  const row = goalSets.map(([, g]) => String(baseCardioMinutes(bf, g)).padStart(16)).join('');
  console.log(String(bf).padEnd(6) + row);
}
console.log('\nSPEC: 27->15, 24->12, 21->8, 18->5');
console.log('\nMonotonic check (must never rise as BF falls):');
for (const [name, g] of goalSets) {
  const series = [30,27,24,21,18,15,12].map(bf => baseCardioMinutes(bf, g));
  const ok = series.every((v,i) => i===0 || v <= series[i-1]);
  console.log(`  ${name.padEnd(16)} ${series.join(' -> ')}  ${ok ? 'OK' : 'NOT MONOTONIC'}`);
}
