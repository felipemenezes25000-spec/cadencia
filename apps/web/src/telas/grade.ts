export interface Visao {
  readonly chave: 'dia' | 'semana' | 'mes' | 'profissional' | 'sala';
  readonly rotulo: string;
  readonly atalho: '1' | '2' | '3' | '4' | '5';
}

export const VISOES: readonly Visao[] = [
  { chave: 'dia',          rotulo: 'Dia',              atalho: '1' },
  { chave: 'semana',       rotulo: 'Semana',           atalho: '2' },
  { chave: 'mes',          rotulo: 'Mês',              atalho: '3' },
  { chave: 'profissional', rotulo: 'Por profissional', atalho: '4' },
  { chave: 'sala',         rotulo: 'Por sala',         atalho: '5' },
];

export interface ConfiguracaoDaGrade {
  readonly inicioMin: number;
  readonly passoMin: number;
  readonly timezone: string;
}

export interface PosicaoNaGrade {
  readonly linhaInicio: number;
  readonly linhaFim: number;
}

function minutosLocais(iso: string, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
  const [h, m] = fmt.format(Date.parse(iso)).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function posicaoNaGrade(
  startsAt: string, endsAt: string, cfg: ConfiguracaoDaGrade,
): PosicaoNaGrade {
  const inicio = minutosLocais(startsAt, cfg.timezone);
  const fim = minutosLocais(endsAt, cfg.timezone);
  const linhaInicio = Math.floor((inicio - cfg.inicioMin) / cfg.passoMin) + 1;
  const linhaFim = Math.max(
    linhaInicio + 1, Math.ceil((fim - cfg.inicioMin) / cfg.passoMin) + 1);
  return { linhaInicio, linhaFim };
}

export function faixasDoDia(
  cfg: { inicioMin: number; fimMin: number; passoMin: number },
): string[] {
  const faixas: string[] = [];
  for (let m = cfg.inicioMin; m < cfg.fimMin; m += cfg.passoMin) {
    faixas.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return faixas;
}
