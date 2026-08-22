'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface Encaminhamento {
  id: string; patientId: string; pacienteNome: string; especialidade: string;
  sigtapCode: string | null; prioridade: 'normal' | 'prioritaria' | 'urgente';
  status: 'solicitado' | 'em_regulacao' | 'agendado' | 'atendido' | 'devolvido' | 'cancelado';
  motivo: string; createdAt: string;
}

export default function PaginaRegulacao() {
  const { clinicId, csrfToken } = useSessao();
  const [itens,setItens]=useState<Encaminhamento[]>([]),[patientId,setPatientId]=useState(''),[especialidade,setEspecialidade]=useState(''),[motivo,setMotivo]=useState(''),[prioridade,setPrioridade]=useState<'normal'|'prioritaria'|'urgente'>('normal'),[erro,setErro]=useState<string|null>(null);
  async function carregar(){const r=await apiFetch<{itens:Encaminhamento[]}>('/v1/regulacao/encaminhamentos',{clinicId,csrfToken});setItens(r.itens);}
  useEffect(()=>{void carregar().catch(()=>setErro('Não foi possível carregar a fila.'));},[clinicId,csrfToken]);
  async function enviar(e:FormEvent){e.preventDefault();setErro(null);try{await apiFetch('/v1/regulacao/encaminhamentos',{method:'POST',body:{patientId,especialidade,motivo,prioridade},clinicId,csrfToken});setPatientId('');setEspecialidade('');setMotivo('');setPrioridade('normal');await carregar();}catch{setErro('Não foi possível criar o encaminhamento.');}}
  return <div className="cadencia-page space-y-5"><header><p className="cadencia-kicker">SUS · Regulação</p><h1 className="text-2xl font-bold text-text">Fila de encaminhamentos</h1><p className="mt-1 text-sm text-text-muted">Referência assistencial entre unidades, com prioridade e rastreabilidade.</p></header>{erro?<p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{erro}</p>:null}<form onSubmit={enviar} className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-4"><label className="grid gap-1 text-sm">ID do cidadão<input required value={patientId} onChange={(e)=>setPatientId(e.target.value)} className="rounded-lg border border-line bg-canvas px-3 py-2"/></label><label className="grid gap-1 text-sm">Especialidade<input required value={especialidade} onChange={(e)=>setEspecialidade(e.target.value)} className="rounded-lg border border-line bg-canvas px-3 py-2"/></label><label className="grid gap-1 text-sm">Prioridade<select value={prioridade} onChange={(e)=>setPrioridade(e.target.value as typeof prioridade)} className="rounded-lg border border-line bg-canvas px-3 py-2"><option value="normal">Normal</option><option value="prioritaria">Prioritária</option><option value="urgente">Urgente</option></select></label><label className="grid gap-1 text-sm md:col-span-3">Motivo<input required value={motivo} onChange={(e)=>setMotivo(e.target.value)} className="rounded-lg border border-line bg-canvas px-3 py-2"/></label><button className="self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Encaminhar</button></form><section className="overflow-hidden rounded-xl border border-line bg-surface">{itens.length===0?<p className="p-6 text-sm text-text-muted">Nenhum encaminhamento na fila.</p>:<ul className="divide-y divide-line">{itens.map((x)=><li key={x.id} className="grid gap-2 p-4 md:grid-cols-[1fr_180px_130px] md:items-center"><div><strong className="text-sm text-text">{x.pacienteNome}</strong><p className="text-sm text-text-muted">{x.especialidade} · {x.motivo}</p></div><span className="text-xs font-semibold uppercase text-text-muted">{x.prioridade}</span><span className="text-xs font-semibold text-accent">{x.status.replace('_',' ')}</span></li>)}</ul>}</section></div>;
}
