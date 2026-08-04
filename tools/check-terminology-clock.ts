import { collectTerminologyFiles, findClockUsages } from './terminology-clock';

const achados = findClockUsages(collectTerminologyFiles());
if (achados.length > 0) {
  for (const a of achados) {
    console.error(`${a.path}:${a.line}  uso de relogio em terminologia: ${a.token}`);
  }
  console.error(
    '\nTerminologia se resolve pela data do evento (occurred_date), nunca pela data de hoje.',
  );
  process.exit(1);
}
console.log('ok: nenhum uso de relogio em codigo de terminologia');
