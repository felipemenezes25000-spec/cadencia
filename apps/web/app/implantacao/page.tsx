'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

type CheckStatus = 'ok' | 'warning' | 'blocked';
interface ReadinessCheck { id:string; rotulo:string; status:CheckStatus; detalhe:string; }
interface Readiness {
  unidade:{ nome:string; municipioIbge:string|null; uf:string|null; cnes:string|null };
  prontoParaGoLive:boolean; checks:ReadinessCheck[]; observacao:string;
}
interface Migration {
  id:string; sourceSystem:string; sourceVersion:string|null; sourceKind:string; status:string;
  recebidos:number; validos:number; importados:number; conciliados:number; rejeitados:number;
  createdAt:string; updatedAt:string;
}
interface Evidence {
  id:string; evidenceType:string; status:'ok'|'warning'|'failed'; happenedAt:string; summary:string;
}
interface OperationProfile {
  slaMensalPercentual:number; rpoMinutos:number; rtoMinutos:number; retencaoProntuarioAnos:number;
  residenciaDadosPais:string; intervaloTesteRestoreDias:number;
}
interface Interop { rndsStage:string; esusApsStage:string; entregas:{target:string;status:string;total:number}[]; }

function rotuloStatus(status: CheckStatus): string {
  return status === 'ok' ? 'Pronto' : status === 'warning' ? 'Atenção' : 'Bloqueado';
}

export default function PaginaImplantacaoPublica() {
  const { clinicId, csrfToken } = useSessao();
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [migracoes,setMigracoes]=useState<Migration[]>([]);
  const [evidencias,setEvidencias]=useState<Evidence[]>([]);
  const [operacao,setOperacao]=useState<OperationProfile|null>(null);
  const [interop,setInterop]=useState<Interop|null>(null);
  const [erro,setErro]=useState<string|null>(null);

  useEffect(()=>{
    let vivo=true;
    void Promise.all([
      apiFetch<Readiness>('/v1/implantacao/readiness',{clinicId,csrfToken}),
      apiFetch<{itens:Migration[]}>('/v1/implantacao/migracoes',{clinicId,csrfToken}),
      apiFetch<{itens:Evidence[]}>('/v1/implantacao/evidencias',{clinicId,csrfToken}),
      apiFetch<OperationProfile>('/v1/implantacao/operacao',{clinicId,csrfToken}),
      apiFetch<Interop>('/v1/implantacao/interoperabilidade',{clinicId,csrfToken}),
    ]).then(([r,m,e,o,i])=>{
      if(!vivo)return;
      setReadiness(r);setMigracoes(m.itens);setEvidencias(e.itens);setOperacao(o);setInterop(i);
    }).catch(()=>{if(vivo)setErro('Não foi possível carregar a prontidão de implantação.');});
    return()=>{vivo=false;};
  },[clinicId,csrfToken]);

  if(erro)return <div className="cadencia-page"><p role="alert" className="rounded-lg bg-danger/10 p-4 text-sm text-danger">{erro}</p></div>;
  if(!readiness||!operacao||!interop)return <div className="cadencia-page"><p className="text-sm text-text-muted">Carregando implantação pública…</p></div>;

  return <div className="cadencia-page space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="cadencia-kicker">PEC Público · Implantação</p>
        <h1 className="text-2xl font-bold text-text">Prontidão para go-live</h1>
        <p className="mt-1 text-sm text-text-muted">{readiness.unidade.nome} · {readiness.unidade.cnes?`CNES ${readiness.unidade.cnes}`:'CNES pendente'}</p>
      </div>
      <div className={`rounded-xl border px-4 py-3 ${readiness.prontoParaGoLive?'border-ok/30 bg-ok/10':'border-danger/30 bg-danger/10'}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Estado geral</p>
        <p className="mt-1 text-lg font-bold">{readiness.prontoParaGoLive?'Pronto para go-live':'Há bloqueios'}</p>
      </div>
    </header>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {readiness.checks.map((c)=><article key={c.id} className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">{c.rotulo}</h2>
          <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${c.status==='ok'?'bg-ok/10 text-ok':c.status==='warning'?'bg-warning/10 text-warning':'bg-danger/10 text-danger'}`}>{rotuloStatus(c.status)}</span>
        </div>
        <p className="mt-2 text-sm text-text-muted">{c.detalhe}</p>
      </article>)}
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold text-text">Operação contratual</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-text-muted">SLA mensal</dt><dd className="font-semibold">{operacao.slaMensalPercentual}%</dd></div>
          <div><dt className="text-text-muted">Residência</dt><dd className="font-semibold">{operacao.residenciaDadosPais}</dd></div>
          <div><dt className="text-text-muted">RPO</dt><dd className="font-semibold">{operacao.rpoMinutos} min</dd></div>
          <div><dt className="text-text-muted">RTO</dt><dd className="font-semibold">{operacao.rtoMinutos} min</dd></div>
          <div><dt className="text-text-muted">Retenção</dt><dd className="font-semibold">{operacao.retencaoProntuarioAnos} anos</dd></div>
          <div><dt className="text-text-muted">Teste de restore</dt><dd className="font-semibold">a cada {operacao.intervaloTesteRestoreDias} dias</dd></div>
        </dl>
      </article>
      <article className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold text-text">Interoperabilidade</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-line p-3"><p className="text-text-muted">RNDS</p><p className="mt-1 font-semibold">{interop.rndsStage}</p></div>
          <div className="rounded-lg border border-line p-3"><p className="text-text-muted">e-SUS APS</p><p className="mt-1 font-semibold">{interop.esusApsStage}</p></div>
        </div>
        <p className="mt-3 text-xs text-text-muted">O estado exibido é operacional. Homologação e credenciamento oficiais continuam sendo evidências externas.</p>
      </article>
    </section>

    <section className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line p-5"><h2 className="font-semibold text-text">Migrações de dados</h2><p className="mt-1 text-sm text-text-muted">Extração, validação, importação e reconciliação por unidade.</p></div>
      {migracoes.length===0?<p className="p-5 text-sm text-text-muted">Nenhuma migração registrada.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase text-text-muted"><tr><th className="p-4">Origem</th><th className="p-4">Status</th><th className="p-4">Recebidos</th><th className="p-4">Importados</th><th className="p-4">Conciliados</th><th className="p-4">Rejeitados</th></tr></thead><tbody>{migracoes.map((m)=><tr key={m.id} className="border-t border-line"><td className="p-4 font-medium">{m.sourceSystem}{m.sourceVersion?` · ${m.sourceVersion}`:''}</td><td className="p-4">{m.status}</td><td className="p-4">{m.recebidos}</td><td className="p-4">{m.importados}</td><td className="p-4">{m.conciliados}</td><td className="p-4">{m.rejeitados}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line p-5"><h2 className="font-semibold text-text">Evidências operacionais</h2><p className="mt-1 text-sm text-text-muted">Restore, DR, segurança, treinamento, homologação e aceite de go-live.</p></div>
      {evidencias.length===0?<p className="p-5 text-sm text-text-muted">Nenhuma evidência registrada.</p>:<ul className="divide-y divide-line">{evidencias.slice(0,20).map((e)=><li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-text">{e.summary}</p><p className="mt-1 text-xs text-text-muted">{e.evidenceType} · {new Date(e.happenedAt).toLocaleString('pt-BR')}</p></div><span className="text-xs font-semibold uppercase text-text-muted">{e.status}</span></li>)}</ul>}
    </section>

    <p className="text-xs text-text-muted">{readiness.observacao}</p>
  </div>;
}
