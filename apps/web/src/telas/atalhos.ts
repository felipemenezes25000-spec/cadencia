export type TipoDeGatilho = 'codigo' | 'modelo' | 'valor_anterior';

export interface Gatilho { readonly tipo: TipoDeGatilho; readonly termo: string }

export function gatilhoDe(texto: string): Gatilho | null {
  const m = /^([#/@])(\S*)$/.exec(texto.trim());
  if (m === null) return null;
  const tipo = m[1] === '#' ? 'codigo' : m[1] === '/' ? 'modelo' : 'valor_anterior';
  return { tipo, termo: m[2] ?? '' };
}

export interface AtalhoDoAtendimento {
  readonly combinacao: string;
  readonly acao: string;
  readonly descricao: string;
}

export const ATALHOS_DO_ATENDIMENTO: readonly AtalhoDoAtendimento[] = [
  { combinacao: 'Ctrl+R', acao: 'prescrever', descricao: 'Prescrever ao lado' },
  { combinacao: 'Ctrl+E', acao: 'pedir_exame', descricao: 'Pedido de exame' },
  { combinacao: 'Ctrl+D', acao: 'emitir_documento', descricao: 'Documento' },
  { combinacao: 'Ctrl+I', acao: 'transcricao_por_ia', descricao: 'Transcrição por IA' },
  { combinacao: 'Ctrl+;', acao: 'inserir_data_hora_do_servidor',
    descricao: 'Data/hora do servidor' },
  { combinacao: 'Ctrl+$', acao: 'cobrar', descricao: 'Cobrar' },
  { combinacao: 'Ctrl+ArrowUp', acao: 'secao_anterior', descricao: 'Seção anterior' },
  { combinacao: 'Ctrl+ArrowDown', acao: 'proxima_secao', descricao: 'Próxima seção' },
  { combinacao: 'Ctrl+Enter', acao: 'finalizar', descricao: 'Finalizar atendimento' },
];

export function deveIgnorarTeclaSimples(
  alvo: { tagName: string; isContentEditable: boolean } | null,
): boolean {
  if (alvo === null) return false;
  return alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable;
}
