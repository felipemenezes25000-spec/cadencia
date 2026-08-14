import { Skeleton } from './Skeleton';

export type FormaDePagina =
  | 'painel'
  | 'tabela'
  | 'lista'
  | 'formulario'
  | 'duasColunas';

export interface SkeletonDePaginaProps {
  readonly forma: FormaDePagina;
  /** Linhas da tabela/lista. Ignorado nas demais formas. */
  readonly linhas?: number;
  readonly rotulo?: string;
}

/**
 * Esqueleto de rota, por formato de tela.
 *
 * Existia um único `app/loading.tsx` — título, quatro cartões de KPI e um bloco
 * de 440px — servindo as 52 rotas. Numa tela de tabela ou na de conversas esse
 * formato não descreve nada do que vai chegar: o usuário vê quatro cartões
 * piscarem e serem substituídos por uma tabela. O salto de layout é justamente
 * o que o esqueleto deveria evitar, então o genérico piorava o que tentava
 * resolver.
 *
 * Uma região live só, no contêiner: as barras entram como `decorativo` para o
 * leitor de tela ouvir "Carregando" uma vez, e não uma vez por barra.
 */
export function SkeletonDePagina({
  forma,
  linhas = 8,
  rotulo = 'Carregando conteúdo',
}: SkeletonDePaginaProps) {
  return (
    <div className="cadencia-page space-y-6" role="status" aria-label={rotulo}>
      <Cabecalho />
      {forma === 'painel' ? <Painel /> : null}
      {forma === 'tabela' ? <Tabela linhas={linhas} /> : null}
      {forma === 'lista' ? <Lista linhas={linhas} /> : null}
      {forma === 'formulario' ? <Formulario /> : null}
      {forma === 'duasColunas' ? <DuasColunas linhas={linhas} /> : null}
    </div>
  );
}

/* ── Peças ───────────────────────────────────────────────────────── */

function Cabecalho() {
  return (
    <div className="space-y-2">
      <Skeleton decorativo variant="text" width="220px" />
      <Skeleton decorativo variant="text" width="360px" />
    </div>
  );
}

function Painel() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} decorativo variant="card" height="78px" />
        ))}
      </div>
      <Skeleton decorativo variant="card" height="440px" />
    </>
  );
}

function Tabela({ linhas }: { readonly linhas: number }) {
  return (
    <div className="space-y-3">
      {/* barra de filtros */}
      <div className="flex flex-wrap gap-2">
        <Skeleton decorativo variant="card" height="34px" className="w-[180px]" />
        <Skeleton decorativo variant="card" height="34px" className="w-[140px]" />
        <Skeleton decorativo variant="card" height="34px" className="ml-auto w-[100px]" />
      </div>
      <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <Skeleton decorativo variant="text" width="40%" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: linhas }, (_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton decorativo variant="table-row" height="20px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Lista({ linhas }: { readonly linhas: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3"
        >
          <Skeleton decorativo variant="avatar" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton decorativo variant="text" width="34%" />
            <Skeleton decorativo variant="text" width="56%" />
          </div>
          <Skeleton decorativo variant="card" height="28px" className="w-[84px]" />
        </div>
      ))}
    </div>
  );
}

function Formulario() {
  return (
    <div className="space-y-4 rounded-[var(--r-lg)] border border-line bg-surface p-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton decorativo variant="text" width="120px" />
          <Skeleton decorativo variant="card" height="38px" />
        </div>
      ))}
      <Skeleton decorativo variant="card" height="36px" className="w-[140px]" />
    </div>
  );
}

function DuasColunas({ linhas }: { readonly linhas: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="space-y-2">
        {Array.from({ length: linhas }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[var(--r-lg)] border border-line bg-surface px-3 py-2.5"
          >
            <Skeleton decorativo variant="avatar" className="h-9 w-9" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton decorativo variant="text" width="52%" />
              <Skeleton decorativo variant="text" width="78%" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton decorativo variant="card" height="520px" className="max-md:hidden" />
    </div>
  );
}
