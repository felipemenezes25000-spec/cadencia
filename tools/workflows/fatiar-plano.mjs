// Fatia um plano de implementacao em um arquivo por tarefa.
//
// Os agentes executores leem UMA tarefa cada, e nao o plano inteiro — um plano de
// 680 mil caracteres nao cabe no contexto de quem so precisa da Task 37. As fatias
// sao derivadas, nunca versionadas: o plano e a fonte da verdade.
//
//   node tools/workflows/fatiar-plano.mjs docs/superpowers/plans/<plano>.md .tasks-fase1
//
// Rode isto antes de lancar o workflow de execucao numa sessao nova.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [, , planoPath, destino] = process.argv;

if (!planoPath || !destino) {
  console.error('uso: node tools/workflows/fatiar-plano.mjs <plano.md> <diretorio-destino>');
  process.exit(1);
}

const texto = readFileSync(planoPath, 'utf8');

// O cabecalho e tudo antes da primeira Parte: objetivo, arquitetura, stack e a
// secao "Antes de comecar". Serve de contexto quando alguem le uma fatia solta.
const inicioDasPartes = texto.search(/^## Parte /m);
const cabecalho = inicioDasPartes > 0 ? texto.slice(0, inicioDasPartes) : '';

const marcadores = [...texto.matchAll(/^### Task (\S+?):/gm)].map((m) => ({
  numero: m[1],
  inicio: m.index ?? 0,
}));

if (marcadores.length === 0) {
  console.error(`nenhuma tarefa encontrada em ${planoPath} (esperado "### Task N:")`);
  process.exit(1);
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

if (cabecalho !== '') {
  writeFileSync(join(destino, '_contexto.md'), cabecalho, 'utf8');
}

marcadores.forEach((marcador, i) => {
  const fim = i + 1 < marcadores.length ? marcadores[i + 1].inicio : texto.length;
  writeFileSync(
    join(destino, `task-${marcador.numero}.md`),
    texto.slice(marcador.inicio, fim).trimEnd(),
    'utf8',
  );
});

const numeros = marcadores.map((m) => Number(m.numero)).filter((n) => Number.isFinite(n));
const lacunas = [];
for (let n = Math.min(...numeros); n <= Math.max(...numeros); n += 1) {
  if (!numeros.includes(n)) lacunas.push(n);
}

console.log(`${marcadores.length} tarefas fatiadas em ${destino}/`);
console.log(`faixa: ${Math.min(...numeros)} a ${Math.max(...numeros)}`);
console.log(lacunas.length === 0 ? 'sem lacuna de numeracao' : `LACUNAS: ${lacunas.join(', ')}`);
