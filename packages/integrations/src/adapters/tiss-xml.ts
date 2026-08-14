import { isoFromMs, systemClock } from '@cadencia/kernel';
import type { TissGuiaConsulta, TissGuiaSadt, TissLote } from '../contracts/tiss-transport';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tag(name: string, value: string | number): string {
  return `<ans:${name}>${esc(String(value))}</ans:${name}>`;
}

function beneficiarioXml(b: TissGuiaConsulta['beneficiario']): string {
  return `<ans:dadosBeneficiario>
  ${tag('numeroCarteira', b.numeroCarteira)}
  ${tag('nomeBeneficiario', b.nomeBeneficiario)}
  ${b.cns !== undefined ? tag('numeroCNS', b.cns) : ''}
</ans:dadosBeneficiario>`;
}

function profissionalXml(p: TissGuiaConsulta['profissional'], wrapper: string): string {
  return `<ans:${wrapper}>
  ${tag('nomeProfissional', p.nomeProfissional)}
  <ans:conselhoProfissional>
    ${tag('siglaConselho', p.conselhoProfissional)}
    ${tag('numeroConselho', p.numeroConselho)}
    ${tag('UF', p.uf)}
  </ans:conselhoProfissional>
  ${tag('CBOS', p.cbos)}
</ans:${wrapper}>`;
}

function guiaConsultaXml(g: TissGuiaConsulta): string {
  return `<ans:guiaConsulta>
  <ans:cabecalhoGuia>
    ${tag('registroANS', g.registroAns)}
    ${tag('numeroGuiaPrestador', g.numeroGuia)}
  </ans:cabecalhoGuia>
  ${tag('dataAtendimento', g.dataAtendimento)}
  ${tag('tipoConsulta', g.tipoConsulta)}
  ${tag('indicacaoAcidente', g.indicacaoAcidente)}
  ${beneficiarioXml(g.beneficiario)}
  ${profissionalXml(g.profissional, 'profissionalExecutante')}
  <ans:procedimentoRealizado>
    ${tag('codigoTabela', g.procedimento.codigoTabela)}
    ${tag('codigoProcedimento', g.procedimento.codigoProcedimento)}
    ${tag('quantidadeExecutada', g.procedimento.quantidadeExecutada)}
    ${tag('valorUnitario', g.procedimento.valorUnitario.toFixed(2))}
    ${tag('valorTotal', (g.procedimento.quantidadeExecutada * g.procedimento.valorUnitario).toFixed(2))}
  </ans:procedimentoRealizado>
</ans:guiaConsulta>`;
}

function guiaSadtXml(g: TissGuiaSadt): string {
  const procs = g.procedimentos.map((p) =>
    `<ans:procedimentoExecutadoOuSolicitado>
  ${tag('codigoTabela', p.codigoTabela)}
  ${tag('codigoProcedimento', p.codigoProcedimento)}
  ${tag('descricaoProcedimento', p.descricaoProcedimento)}
  ${tag('quantidadeSolicitada', p.quantidadeSolicitada)}
  ${tag('quantidadeExecutada', p.quantidadeExecutada)}
  ${tag('valorUnitario', p.valorUnitario.toFixed(2))}
  ${tag('valorTotal', (p.quantidadeExecutada * p.valorUnitario).toFixed(2))}
</ans:procedimentoExecutadoOuSolicitado>`).join('\n');

  return `<ans:guiaSP-SADT>
  <ans:cabecalhoGuia>
    ${tag('registroANS', g.registroAns)}
    ${tag('numeroGuiaPrestador', g.numeroGuia)}
  </ans:cabecalhoGuia>
  ${tag('dataAtendimento', g.dataAtendimento)}
  ${tag('tipoAtendimento', g.tipoAtendimento)}
  ${tag('indicacaoClinica', g.indicacaoClinica)}
  ${beneficiarioXml(g.beneficiario)}
  ${profissionalXml(g.profissionalSolicitante, 'profissionalSolicitante')}
  ${g.profissionalExecutante ? profissionalXml(g.profissionalExecutante, 'profissionalExecutante') : ''}
  <ans:procedimentosExecutados>
    ${procs}
  </ans:procedimentosExecutados>
</ans:guiaSP-SADT>`;
}

export function serializeLoteXml(lote: TissLote): string {
  const guias: string[] = [];
  for (const g of lote.guiasConsulta ?? []) guias.push(guiaConsultaXml(g));
  for (const g of lote.guiasSadt ?? []) guias.push(guiaSadtXml(g));

  return `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS
  xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>
      <ans:sequencialTransacao>${esc(lote.numeroLote)}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${isoFromMs(systemClock.nowMs()).slice(0, 10)}</ans:dataRegistroTransacao>
      <ans:horaRegistroTransacao>${isoFromMs(systemClock.nowMs()).slice(11, 19)}</ans:horaRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem>
      <ans:identificacaoPrestador>
        ${tag('codigoPrestadorNaOperadora', lote.registroAns)}
      </ans:identificacaoPrestador>
    </ans:origem>
    <ans:destino>
      ${tag('registroANS', lote.registroAns)}
    </ans:destino>
    <ans:versaoPadrao>4.01.00</ans:versaoPadrao>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      ${tag('numeroLote', lote.numeroLote)}
      <ans:guiasTISS>
        ${guias.join('\n')}
      </ans:guiasTISS>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>
</ans:mensagemTISS>`;
}

export function wrapInSoapEnvelope(tissXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tiss="http://www.ans.gov.br/tiss/ws/tipos/tisscancelaguia/v40100">
  <soap:Body>
    <tiss:tissLoteGuias>
      ${tissXml}
    </tiss:tissLoteGuias>
  </soap:Body>
</soap:Envelope>`;
}
