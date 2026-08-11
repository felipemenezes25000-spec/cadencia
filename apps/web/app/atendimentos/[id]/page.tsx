/*
 * A rota plural e a URL canonica exposta pela navegacao nova, mas o workspace
 * clinico real continua sendo o mesmo da rota historica singular. Reexportar
 * evita duas implementacoes concorrentes e preserva autosave, permissoes,
 * anexos, SADT, cobranca e selamento do prontuario.
 */
export { default } from '../../atendimento/[id]/page';
