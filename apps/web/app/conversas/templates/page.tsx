'use client';

import { useCallback, useEffect, useState } from 'react';
import { TemplatesDeMensagem, type Template } from '../../../src/telas/TemplatesDeMensagem';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface TemplateDaApi {
  templateId: string;
  name: string;
  bodyTemplate: string;
  category: string;
  channel: string;
  status?: string;
}

export default function PaginaTemplates() {
  const { clinicId, csrfToken } = useSessao();
  const [templates, setTemplates] = useState<readonly Template[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ itens: TemplateDaApi[] }>(
        '/v1/messaging/templates', { clinicId, csrfToken });
      setTemplates(r.itens.map((x) => ({
        id: x.templateId, titulo: x.name, conteudo: x.bodyTemplate,
      })));
    } catch {
      setErro('Não foi possível carregar os templates.');
    }
  }, [clinicId, csrfToken]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="grid gap-6">
      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

      <TemplatesDeMensagem
        templates={templates}
        // Criar e editar exigem aprovação da Meta antes de valer no WhatsApp, e
        // o fluxo de submissão ainda não existe. Abrir um formulário que grava
        // um template que nunca será aprovado faria a clínica montar campanha em
        // cima de mensagem que não envia.
        aoCriar={() => setErro(
          'Criar template exige aprovação da Meta. O fluxo de submissão ainda não está '
          + 'ligado — por enquanto os templates vêm do painel do WhatsApp Business.')}
        aoEditar={() => setErro(
          'Editar template aprovado exige nova aprovação da Meta. Ainda não ligado.')}
        aoExcluir={() => setErro(
          'Excluir template no WhatsApp Business é feito no painel da Meta.')}
      />
    </div>
  );
}
