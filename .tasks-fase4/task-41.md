### Task 41: tipos de entrada do serializador TISS — GuiaConsultaInput e LoteConsultaInput

**Arquivos**

- Criar `packages/tiss/src/serializer/types.ts`
- Teste `packages/tiss/src/serializer/types.test.ts`

**Passos**

- [ ] Criar o arquivo de tipos `packages/tiss/src/serializer/types.ts`:

```ts
/**
 * Tipos de entrada do serializador XML TISS.
 *
 * Estes tipos sao PUROS — sem dependencia de banco, sem I/O. Representam
 * exatamente os dados necessarios para gerar o XML de um lote de guias de
 * consulta conforme padrao TISS 4.01.00 (Componente Organizacional).
 *
 * Os campos espelham a tabela tiss.encounter_guia_consulta (design §3.9)
 * e o XSD ans:mensagemTISS > prestadorParaOperadora > loteGuias >
 * guiaConsulta.
 */

/** Cabecalho do lote TISS — tag <ans:cabecalho>. */
export interface CabecalhoInput {
  /** Versao do padrao, ex: '4.01.00'. */
  readonly versaoPadrao: string;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Data de geracao do lote, formato 'YYYY-MM-DD'. */
  readonly dataGeracao: string;
  /** Hora de geracao do lote, formato 'HH:MM:SS'. */
  readonly horaGeracao: string;
  /** Numero sequencial da transacao, unico por prestador. */
  readonly sequencialTransacao: string;
}

/** Dados do contratado executante — tag <ans:dadosContratado>. */
export interface ContratadoInput {
  /** Codigo do prestador na operadora. Exatamente um dos tres identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 digitos. */
  readonly cnes: string;
}

/** Dados do profissional executante — tag <ans:profissionalExecutante>. */
export interface ProfissionalExecutanteInput {
  /** Conselho profissional do executante, 2 digitos (ex: '06' = CRM). */
  readonly conselhoProfissional: string;
  /** Numero do registro no conselho. */
  readonly numeroConselho: string;
  /** UF do conselho, 2 letras. */
  readonly ufConselho: string;
  /** CBOS do profissional. */
  readonly cbos: string;
}

/** Uma guia de consulta individual — tag <ans:guiaConsulta>. */
export interface GuiaConsultaInput {
  /** Numero da guia atribuido pelo prestador, unico por operadora. */
  readonly numeroGuiaPrestador: string;
  /** Numero da guia atribuido pela operadora (autorizacao), opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Numero da carteira do beneficiario na operadora. */
  readonly numeroCarteira: string;
  /** Indica se e atendimento a recem-nascido. */
  readonly atendimentoRN: boolean;
  /** Dados do contratado (prestador). */
  readonly contratado: ContratadoInput;
  /** Profissional que executou o procedimento. */
  readonly profissionalExecutante: ProfissionalExecutanteInput;
  /** Indicacao de acidente: '0' nao, '1' trabalho, '2' transito, '9' outros. */
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  /** Regime de atendimento: '01' ambulatorial, etc. */
  readonly regimeAtendimento: string;
  /** Saude ocupacional, opcional. */
  readonly saudeOcupacional?: string;
  /** Cobertura especial, opcional. */
  readonly coberturaEspecial?: string;
  /** Data do atendimento, formato 'YYYY-MM-DD'. Nunca derivada de timestamp. */
  readonly dataAtendimento: string;
  /** Tipo de consulta: '1' primeira, '2' retorno, '3' pre-natal, '4' por encaminhamento. */
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  /** Tabela de procedimento (ex: '22' TUSS). CHECK <> '18' (particular). */
  readonly codigoTabela: string;
  /** Codigo do procedimento na tabela. */
  readonly codigoProcedimento: string;
  /** Valor do procedimento em centavos inteiros (Money.cents). */
  readonly valorProcedimentoCentavos: number;
  /** Observacao opcional, ate 500 caracteres. */
  readonly observacao?: string;
}

/** Entrada completa para serializar um lote de guias de consulta. */
export interface LoteConsultaInput {
  /** Cabecalho do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Numero do lote, unico por prestador+operadora. */
  readonly numeroLote: string;
  /** Guias do lote. Minimo 1, maximo 100. */
  readonly guias: readonly GuiaConsultaInput[];
}
```

- [ ] Criar o teste `packages/tiss/src/serializer/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './types';

// Teste de compilacao: garante que os tipos sao atribuiveis e que campos
// obrigatorios e opcionais estao corretos. Se o tipo mudar de forma
// incompativel, o teste de compilacao falha.

describe('tipos de entrada do serializador TISS', () => {
  it('LoteConsultaInput aceita lote valido com todos os campos obrigatorios', () => {
    const cabecalho: CabecalhoInput = {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '1',
    };

    const contratado: ContratadoInput = {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    };

    const profissional: ProfissionalExecutanteInput = {
      conselhoProfissional: '06',
      numeroConselho: '123456',
      ufConselho: 'SP',
      cbos: '225120',
    };

    const guia: GuiaConsultaInput = {
      numeroGuiaPrestador: '00001',
      numeroCarteira: '98765432101234567',
      atendimentoRN: false,
      contratado,
      profissionalExecutante: profissional,
      indicacaoAcidente: '9',
      regimeAtendimento: '01',
      dataAtendimento: '2026-08-05',
      tipoConsulta: '1',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimentoCentavos: 15000,
    };

    const lote: LoteConsultaInput = {
      cabecalho,
      registroANS: '339679',
      numeroLote: '0001',
      guias: [guia],
    };

    // Se compilou e criou sem erro de tipo, o contrato esta correto.
    expect(lote.guias).toHaveLength(1);
    expect(lote.cabecalho.versaoPadrao).toBe('4.01.00');
  });

  it('GuiaConsultaInput aceita campos opcionais omitidos', () => {
    const guia: GuiaConsultaInput = {
      numeroGuiaPrestador: '00002',
      numeroCarteira: '11111111111111111',
      atendimentoRN: true,
      contratado: {
        codigoPrestadorNaOperadora: '123456',
        cnes: '7654321',
      },
      profissionalExecutante: {
        conselhoProfissional: '06',
        numeroConselho: '654321',
        ufConselho: 'RJ',
        cbos: '225120',
      },
      indicacaoAcidente: '0',
      regimeAtendimento: '01',
      dataAtendimento: '2026-07-15',
      tipoConsulta: '2',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimentoCentavos: 8000,
    };

    expect(guia.numeroGuiaOperadora).toBeUndefined();
    expect(guia.saudeOcupacional).toBeUndefined();
    expect(guia.coberturaEspecial).toBeUndefined();
    expect(guia.observacao).toBeUndefined();
  });

  it('ContratadoInput aceita cada um dos tres identificadores isoladamente', () => {
    const porCodigo: ContratadoInput = {
      codigoPrestadorNaOperadora: 'ABCD123',
      cnes: '1111111',
    };
    const porCpf: ContratadoInput = {
      cpfContratado: '12345678901',
      cnes: '2222222',
    };
    const porCnpj: ContratadoInput = {
      cnpjContratado: '11222333000181',
      cnes: '3333333',
    };

    expect(porCodigo.codigoPrestadorNaOperadora).toBe('ABCD123');
    expect(porCpf.cpfContratado).toBe('12345678901');
    expect(porCnpj.cnpjContratado).toBe('11222333000181');
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/types.test.ts
```

Saida esperada: 3 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.ts packages/tiss/src/serializer/types.test.ts
git commit -m "feat(tiss): add typed inputs for TISS XML serializer (GuiaConsultaInput, LoteConsultaInput)"
```

---