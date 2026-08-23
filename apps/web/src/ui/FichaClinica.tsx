// apps/web/src/ui/FichaClinica.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { InfoTip } from './ClinicalHelp';
import { Odontograma } from './Odontograma';
import type { CampoDaFicha, SecaoDaFicha } from '../lib/ficha-tipos';

export type { ComponenteDoCampo, CampoDaFicha, SecaoDaFicha } from '../lib/ficha-tipos';

export interface FichaClinicaProps {
  readonly secoes: readonly SecaoDaFicha[];
  readonly valores: Readonly<Record<string, string>>;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: (termo: string) => Promise<readonly { code: string; display: string }[]>;
}

const CLASSE_ENTRADA = cn(
  'w-full rounded-[var(--r-sm)] border border-line-field bg-surface px-3 py-2 text-sm',
  'text-text focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
);

function numeroDecimal(bruto: string): number | null {
  const normalizado = bruto.trim().replace(',', '.');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function comDerivados(
  secoes: readonly SecaoDaFicha[],
  valores: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const campos = secoes.flatMap((s) => s.campos);
  const peso = campos.find((c) => c.code === 'peso');
  const altura = campos.find((c) => c.code === 'altura');
  const imc = campos.find((c) => c.kind === 'imc');
  if (peso === undefined || altura === undefined || imc === undefined) return valores;
  const pesoNumero = numeroDecimal(valores[peso.fieldId] ?? '');
  const alturaNumero = numeroDecimal(valores[altura.fieldId] ?? '');
  if (pesoNumero === null || alturaNumero === null || pesoNumero <= 0 || alturaNumero <= 0) {
    return { ...valores, [imc.fieldId]: '' };
  }
  const alturaMetros = altura.unit === 'm' ? alturaNumero : alturaNumero / 100;
  if (alturaMetros <= 0) return { ...valores, [imc.fieldId]: '' };
  return { ...valores, [imc.fieldId]: (pesoNumero / (alturaMetros * alturaMetros)).toFixed(2) };
}

function ajudaDoCampo(campo: CampoDaFicha): string {
  if (campo.kind === 'imc') return 'Calculado automaticamente com peso e altura. Não precisa digitar.';
  if (campo.kind === 'composto') return 'Cada componente é salvo separadamente para acompanhar a evolução ao longo do tempo.';
  if (campo.kind === 'numerico') return 'Valor estruturado: pode alimentar gráficos, indicadores e histórico longitudinal.';
  if (campo.kind === 'busca_tabela') return 'Escolha no catálogo oficial. Código e descrição ficam preservados no prontuário.';
  if (campo.kind === 'lista_unica' || campo.kind === 'multipla_escolha') return 'Opções padronizadas facilitam busca, relatórios e indicadores.';
  if (campo.kind === 'booleano') return 'Marque quando esta condição se aplicar ao cidadão.';
  if (campo.kind === 'data') return 'Registre a data relacionada a este item clínico.';
  if (campo.kind === 'odontograma') return 'Registro odontológico estruturado vinculado a este atendimento.';
  return 'Registro estruturado desta seção do prontuário.';
}

function RotuloCampo({ campo, htmlFor }: { readonly campo: CampoDaFicha; readonly htmlFor?: string }) {
  const conteudo = (
    <>
      <span>{campo.label}</span>
      {campo.required ? <span aria-hidden="true" className="cadencia-required-badge">Obrigatório</span> : null}
      <InfoTip conteudo={ajudaDoCampo(campo)} rotulo={`Ajuda sobre ${campo.label}`} />
    </>
  );
  return htmlFor ? (
    <label htmlFor={htmlFor} className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">{conteudo}</label>
  ) : (
    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">{conteudo}</span>
  );
}

function BuscaEmTabela({ campo, valor, aoMudar, buscarCodigo }: {
  readonly campo: CampoDaFicha;
  readonly valor: string;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: FichaClinicaProps['buscarCodigo'];
}) {
  const [termo, setTermo] = useState('');
  const [hits, setHits] = useState<readonly { code: string; display: string }[]>([]);

  useEffect(() => {
    if (termo.trim().length < 2) { setHits([]); return undefined; }
    let vivo = true;
    const t = setTimeout(() => {
      void buscarCodigo(termo).then((r) => { if (vivo) setHits(r); }).catch(() => { if (vivo) setHits([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, buscarCodigo]);

  const escolhido = valor === '' ? null : valor.split('|');
  return (
    <div className="grid gap-1.5">
      <RotuloCampo campo={campo} htmlFor={campo.fieldId} />
      <p className="cadencia-field-caption m-0">Digite pelo menos 2 caracteres para buscar por código ou descrição.</p>
      {escolhido !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] border border-accent/30 bg-accent-soft/35 px-3 py-2 text-sm">
          <span><strong className="font-mono">{escolhido[0]}</strong>{escolhido[1] !== undefined ? <span className="ml-2">{escolhido[1]}</span> : null}</span>
          <button type="button" className="text-xs font-semibold text-accent underline" onClick={() => { aoMudar(campo.fieldId, ''); setTermo(''); }}>Trocar</button>
        </div>
      ) : (
        <>
          <input id={campo.fieldId} required={campo.required} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Ex.: J06.9 ou infecção respiratória" className={CLASSE_ENTRADA} />
          {hits.length > 0 ? (
            <ul className="grid gap-0.5 rounded-[var(--r-sm)] border border-line bg-surface p-1 shadow-elev-1">
              {hits.slice(0, 8).map((h) => (
                <li key={h.code}><button type="button" onClick={() => { aoMudar(campo.fieldId, `${h.code}|${h.display}`); setHits([]); }} className="block min-h-10 w-full rounded-[var(--r-sm)] px-2 py-1.5 text-left text-sm hover:bg-surface-hover"><span className="font-mono text-xs">{h.code}</span><span className="ml-2">{h.display}</span></button></li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function Campo({ campo, valores, aoMudar, buscarCodigo }: {
  readonly campo: CampoDaFicha;
  readonly valores: Readonly<Record<string, string>>;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: FichaClinicaProps['buscarCodigo'];
}) {
  const valor = valores[campo.fieldId] ?? '';
  if (campo.kind === 'busca_tabela') return <BuscaEmTabela campo={campo} valor={valor} aoMudar={aoMudar} buscarCodigo={buscarCodigo} />;

  if (campo.kind === 'composto') {
    return (
      <fieldset className="grid gap-2">
        <legend className="w-full"><RotuloCampo campo={campo} /></legend>
        <p className="cadencia-field-caption m-0">Preencha os componentes separadamente; eles serão acompanhados como medidas clínicas.</p>
        <div className="flex gap-2 max-sm:flex-col">
          {campo.componentes.map((k) => {
            const chave = `${campo.fieldId}:${k.observationCode}`;
            return <label key={k.observationCode} className="grid flex-1 gap-1"><span className="text-xs font-semibold text-text-muted">{k.label}</span><span className="flex items-center gap-1.5"><input required={campo.required} inputMode="decimal" value={valores[chave] ?? ''} onChange={(e) => aoMudar(chave, e.target.value)} className={CLASSE_ENTRADA} />{k.unit !== null ? <span className="shrink-0 text-xs text-text-muted">{k.unit}</span> : null}</span></label>;
          })}
        </div>
      </fieldset>
    );
  }

  if (campo.kind === 'imc') {
    return <div className="grid gap-1.5"><RotuloCampo campo={campo} htmlFor={campo.fieldId} /><span className="flex items-center gap-1.5"><input id={campo.fieldId} value={valor} readOnly aria-readonly="true" title="Calculado automaticamente a partir de peso e altura" className={cn(CLASSE_ENTRADA, 'cursor-not-allowed bg-surface-raised font-semibold text-text-muted')} />{campo.unit !== null ? <span className="shrink-0 text-xs text-text-muted">{campo.unit}</span> : null}</span><span className="cadencia-field-caption">Calculado automaticamente por peso e altura.</span></div>;
  }

  if (campo.kind === 'numerico') {
    return <div className="grid gap-1.5"><RotuloCampo campo={campo} htmlFor={campo.fieldId} /><span className="flex items-center gap-1.5"><input id={campo.fieldId} required={campo.required} inputMode="decimal" value={valor} onChange={(e) => aoMudar(campo.fieldId, e.target.value)} className={CLASSE_ENTRADA} />{campo.unit !== null ? <span className="shrink-0 text-xs text-text-muted">{campo.unit}</span> : null}</span></div>;
  }

  if (campo.kind === 'texto_longo') {
    return <div className="grid gap-1.5"><RotuloCampo campo={campo} htmlFor={campo.fieldId} /><textarea id={campo.fieldId} required={campo.required} rows={3} value={valor} onChange={(e) => aoMudar(campo.fieldId, e.target.value)} className={cn(CLASSE_ENTRADA, 'resize-y leading-relaxed')} /></div>;
  }

  if (campo.kind === 'texto_curto' || campo.kind === 'data') {
    return <div className="grid gap-1.5"><RotuloCampo campo={campo} htmlFor={campo.fieldId} /><input id={campo.fieldId} required={campo.required} type={campo.kind === 'data' ? 'date' : 'text'} value={valor} onChange={(e) => aoMudar(campo.fieldId, e.target.value)} className={CLASSE_ENTRADA} /></div>;
  }

  if (campo.kind === 'lista_unica' && campo.options !== null) {
    return <div className="grid gap-1.5"><RotuloCampo campo={campo} htmlFor={campo.fieldId} /><select id={campo.fieldId} required={campo.required} value={valor} onChange={(e) => aoMudar(campo.fieldId, e.target.value)} className={CLASSE_ENTRADA}><option value="">Selecione…</option>{campo.options.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
  }

  if (campo.kind === 'booleano') {
    return <div className="grid gap-2"><RotuloCampo campo={campo} /><label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-text"><input type="checkbox" checked={valor === 'true'} onChange={(e) => aoMudar(campo.fieldId, e.target.checked ? 'true' : 'false')} className="accent-[var(--accent)]" /><span>Sim, esta condição se aplica</span></label></div>;
  }

  if (campo.kind === 'multipla_escolha' && campo.options !== null) {
    const marcados = valor === '' ? [] : valor.split('|');
    return (
      <fieldset className="grid gap-2"><legend className="w-full"><RotuloCampo campo={campo} /></legend><p className="cadencia-field-caption m-0">Marque todas as opções que se aplicam.</p><div className="grid gap-1.5 sm:grid-cols-2">{campo.options.map((o) => { const id = `${campo.fieldId}:${o}`; const marcado = marcados.includes(o); return <label key={o} htmlFor={id} className={cn('flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors', marcado ? 'border-accent/30 bg-accent-soft/45 text-text' : 'border-line bg-surface text-text hover:bg-surface-hover')}><input id={id} type="checkbox" checked={marcado} onChange={(e) => { const proximo = e.target.checked ? campo.options!.filter((x) => x === o || marcados.includes(x)) : marcados.filter((x) => x !== o); aoMudar(campo.fieldId, proximo.join('|')); }} className="accent-[var(--accent)]" />{o}</label>; })}</div></fieldset>
    );
  }

  if (campo.kind === 'odontograma') return <div className="grid gap-2"><RotuloCampo campo={campo} /><Odontograma rotulo={campo.label} valor={valor} aoMudar={(json) => aoMudar(campo.fieldId, json)} /></div>;

  return <p className="rounded-[var(--r-sm)] border border-dashed border-warn/30 bg-warn-soft/35 px-3 py-2 text-xs text-text-muted"><strong>{campo.label}</strong> ({campo.kind}) ainda não é preenchível por esta tela. A configuração foi preservada para não ocultar perda de funcionalidade.</p>;
}

export function FichaClinica(p: FichaClinicaProps) {
  const secoes = p.secoes.filter((s) => s.code !== 'evolucao');
  if (secoes.length === 0) return null;
  const valores = comDerivados(p.secoes, p.valores);

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-accent/15 bg-accent-soft/35 px-3.5 py-3">
        <InfoTip conteudo="Campos estruturados alimentam histórico, gráficos, indicadores e integrações. A evolução narrativa continua no editor acima." rotulo="Sobre a ficha estruturada" className="mt-0.5" />
        <div><p className="m-0 text-xs font-bold text-text">Ficha estruturada do atendimento</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Preencha os dados que precisam ser pesquisáveis e acompanhados ao longo do tempo. Passe o mouse ou toque nos ícones de informação para ver a legenda de cada campo.</p></div>
      </div>
      {secoes.map((s) => (
        <fieldset key={s.sectionId} className="cadencia-clinical-section grid gap-3">
          <legend>{s.label}</legend>
          <p className="cadencia-clinical-section-description">Dados desta seção ficam vinculados ao atendimento e ao histórico longitudinal do cidadão.</p>
          {s.campos.map((c) => <Campo key={c.fieldId} campo={c} valores={valores} aoMudar={p.aoMudar} buscarCodigo={p.buscarCodigo} />)}
        </fieldset>
      ))}
    </div>
  );
}
