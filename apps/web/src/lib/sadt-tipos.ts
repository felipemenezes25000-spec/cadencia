// apps/web/src/lib/sadt-tipos.ts
//
// Tipos da guia SP/SADT, fora do componente.
//
// `emissao-sadt.ts` precisa deles e e um modulo `.ts` puro; importar de um
// `.tsx` faz o tsconfig da raiz exigir `--jsx` para compilar logica que nao tem
// JSX nenhum. Mesmo arranjo de `ficha-tipos.ts`.

export interface ItemDaGuia {
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorCentavos: number;
}

export interface NovaGuiaSadt {
  readonly caraterAtendimento: '1' | '2';
  readonly tipoAtendimento: string;
  readonly indicacaoClinica: string | null;
  readonly procedimentos: readonly ItemDaGuia[];
}
