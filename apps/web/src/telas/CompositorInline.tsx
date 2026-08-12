'use client';

import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { cn } from '../lib/cn';
import { ComboboxDePaciente, type PacienteHit } from '../ui/ComboboxDePaciente';
import { Campo } from '../ui/Campo';
import { Botao } from '../ui/Botao';
import { Select } from '../ui/Select';

export interface ProcedimentoOpcao {
  readonly id: string;
  readonly nome: string;
  readonly duracaoMin: number;
  readonly maisFrequente: boolean;
}

export interface ConvenioOpcao {
  readonly nome: string;
  readonly ultimoDoPaciente: boolean;
}

export interface CompositorInlineProps {
  readonly inicioIso: string;
  /** Paciente conhecido ao abrir a partir da ficha ou da busca global. */
  readonly pacienteInicial?: PacienteHit;
  readonly procedimentos: readonly ProcedimentoOpcao[];
  readonly convenios: readonly ConvenioOpcao[];
  readonly buscarPacientes: (termo: string) => Promise<PacienteHit[]>;
  readonly aoCriarPaciente: (nome: string) =>
    Promise<{ patientId: string; displayName: string }> | void;
  readonly aoAgendar: (i: {
    patientId: string;
    procedureId: string;
    operadoraNome: string;
    /**
     * Dia e hora DE PAREDE, como o usuário digitou nos campos do formulário.
     *
     * Estavam faltando neste contrato, e por isso os dois campos — visíveis,
     * obrigatórios e editáveis — eram simplesmente descartados no submit: o
     * agendamento saía sempre no slot que tinha sido clicado na grade. Quem
     * abria o compositor às 09:00 e corrigia para 10:30 marcava às 09:00, e só
     * descobria quando o paciente aparecia na hora errada.
     */
    data: string;
    horario: string;
    encaixe: boolean;
  }) => Promise<{ appointmentId: string }> | Promise<void>;
  readonly aoFechar: () => void;
  /** Elemento trigger para o popover */
  readonly children?: ReactNode;
  /** Controla se o popover está aberto */
  readonly aberto?: boolean;
}

interface DadosFormulario {
  patientId: string;
  data: string;
  horario: string;
  procedureId: string;
  operadoraNome: string;
  telefone: string;
}

/**
 * Wrapper para Campo com register do react-hook-form, evitando conflitos
 * de exactOptionalPropertyTypes ao espalhar o retorno de register().
 */
function CampoRegistrado({
  rotulo,
  type,
  registro,
  erro,
}: {
  readonly rotulo: string;
  readonly type: string;
  readonly registro: UseFormRegisterReturn;
  readonly erro?: string;
}) {
  return (
    <Campo
      rotulo={rotulo}
      type={type}
      name={registro.name}
      ref={registro.ref}
      onChange={registro.onChange}
      onBlur={registro.onBlur}
      {...(erro != null ? { erro } : {})}
    />
  );
}

/**
 * Campo de telefone com ref combinada (react-hook-form + foco imperativo).
 */
function TelefoneField({
  telefoneRef,
  registro,
}: {
  readonly telefoneRef: RefObject<HTMLInputElement | null>;
  readonly registro: UseFormRegisterReturn;
}) {
  return (
    <Campo
      ref={(el: HTMLInputElement | HTMLTextAreaElement | null) => {
        registro.ref(el);
        // eslint-disable-next-line no-param-reassign -- ref merging
        (telefoneRef as { current: HTMLInputElement | null }).current =
          el as HTMLInputElement | null;
      }}
      rotulo="Telefone"
      inputMode="numeric"
      name={registro.name}
      onChange={registro.onChange}
      onBlur={registro.onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (
            e.currentTarget.form?.elements.namedItem(
              'procedimento',
            ) as HTMLElement
          )?.focus();
        }
      }}
    />
  );
}

export function CompositorInline(p: CompositorInlineProps) {
  const isPopover = p.children != null && p.aberto != null;

  const dataInicial = p.inicioIso.slice(0, 10);
  const horarioInicial = p.inicioIso.slice(11, 16);

  const defaultProcedureId =
    p.procedimentos.find((x) => x.maisFrequente)?.id ??
    p.procedimentos[0]?.id ??
    '';
  const defaultConvenio =
    p.convenios.find((x) => x.ultimoDoPaciente)?.nome ??
    p.convenios[0]?.nome ??
    'Particular';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DadosFormulario>({
    defaultValues: {
      patientId: p.pacienteInicial?.patientId ?? '',
      data: dataInicial,
      horario: horarioInicial,
      procedureId: defaultProcedureId,
      operadoraNome: defaultConvenio,
      telefone: '',
    },
  });

  const [paciente, setPaciente] = useState<{
    patientId: string;
    displayName: string;
  } | null>(p.pacienteInicial
    ? { patientId: p.pacienteInicial.patientId, displayName: p.pacienteInicial.displayName }
    : null);
  const [precisaTelefone, setPrecisaTelefone] = useState(false);
  const [conflito, setConflito] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [tocado, setTocado] = useState(false);
  const telefoneRef = useRef<HTMLInputElement>(null);

  const procedureId = watch('procedureId');
  const operadoraNome = watch('operadoraNome');

  useEffect(() => {
    if (precisaTelefone) telefoneRef.current?.focus();
  }, [precisaTelefone]);

  useEffect(() => {
    if (p.pacienteInicial && paciente === null) {
      setPaciente({
        patientId: p.pacienteInicial.patientId,
        displayName: p.pacienteInicial.displayName,
      });
      setValue('patientId', p.pacienteInicial.patientId, { shouldValidate: true });
    }
  }, [p.pacienteInicial, paciente, setValue]);

  async function submitInterno(
    dados: DadosFormulario,
    encaixe: boolean,
  ): Promise<void> {
    try {
      await p.aoAgendar({
        patientId: dados.patientId,
        procedureId: dados.procedureId,
        operadoraNome: dados.operadoraNome,
        data: dados.data,
        horario: dados.horario,
        encaixe,
      });
      setConflito(false);
    } catch (e) {
      if ((e as { codigo?: string }).codigo === 'horario_ocupado')
        setConflito(true);
      else throw e;
    }
  }

  function fecharComConfirmacao() {
    if (tocado) setConfirmandoDescarte(true);
    else p.aoFechar();
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSubmit((dados) => submitInterno(dados, false))();
      return;
    }
    if (e.key === 'Escape' && !isPopover) {
      e.preventDefault();
      fecharComConfirmacao();
    }
  }

  const formulario = (
    <form
      role="form"
      aria-label="Novo agendamento"
      onKeyDown={aoTeclar}
      onChange={() => setTocado(true)}
      onSubmit={handleSubmit((dados) => submitInterno(dados, false))}
      className={cn(
        'grid gap-[var(--s-4)] p-[var(--s-5)]',
        !isPopover &&
          'border border-accent rounded-[var(--r-md)] bg-surface shadow-elev-1',
      )}
    >
      <h3 className="text-sm font-semibold text-text">Novo agendamento</h3>

      <input
        type="hidden"
        {...register('patientId', { required: 'Selecione um paciente' })}
      />

      {paciente === null ? (
        <>
          <ComboboxDePaciente
            rotulo="Quem"
            autoFocus
            buscar={(t) => {
              setTocado(true);
              return p.buscarPacientes(t);
            }}
            aoEscolher={(h) => {
              setPaciente({
                patientId: h.patientId,
                displayName: h.displayName,
              });
              setValue('patientId', h.patientId, { shouldValidate: true });
            }}
            aoCriar={(nome) => {
              const r = p.aoCriarPaciente(nome);
              if (r instanceof Promise) {
                void r.then((novo) => {
                  setPaciente(novo);
                  setValue('patientId', novo.patientId, {
                    shouldValidate: true,
                  });
                  setPrecisaTelefone(true);
                });
              }
            }}
          />
          {errors.patientId && (
            <p className="text-xs text-danger" role="alert">
              {errors.patientId.message}
            </p>
          )}
        </>
      ) : (
        <p className="m-0 font-medium text-text">{paciente.displayName}</p>
      )}

      {precisaTelefone && (
        <TelefoneField
          telefoneRef={telefoneRef}
          registro={register('telefone')}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <CampoRegistrado
          rotulo="Data"
          type="date"
          registro={register('data', { required: 'Obrigatório' })}
          {...(errors.data?.message != null ? { erro: errors.data.message } : {})}
        />
        <CampoRegistrado
          rotulo="Horário"
          type="time"
          registro={register('horario', { required: 'Obrigatório' })}
          {...(errors.horario?.message != null ? { erro: errors.horario.message } : {})}
        />
      </div>

      <Select
        rotulo="Procedimento"
        name="procedimento"
        opcoes={p.procedimentos.map((x) => ({
          value: x.id,
          label: `${x.nome} · ${x.duracaoMin} min`,
        }))}
        value={procedureId}
        onChange={(v) => setValue('procedureId', v)}
      />

      <Select
        rotulo="Convênio"
        opcoes={[
          ...p.convenios.map((c) => ({ value: c.nome, label: c.nome })),
          ...(p.convenios.some((c) => c.nome === 'Particular')
            ? []
            : [{ value: 'Particular', label: 'Particular' }]),
        ]}
        value={operadoraNome}
        onChange={(v) => setValue('operadoraNome', v)}
      />

      {conflito && (
        <div role="alert" className="grid gap-[var(--s-3)]">
          <span className="text-danger text-[var(--fs-13)]">
            Já existe atendimento neste horário para o profissional.
          </span>
          <Botao
            variante="secundario"
            type="button"
            onClick={() => {
              void handleSubmit((dados) => submitInterno(dados, true))();
            }}
          >
            Encaixar mesmo assim
          </Botao>
        </div>
      )}

      <div className="flex justify-end gap-[var(--s-3)] pt-[var(--s-3)]">
        <Botao variante="fantasma" type="button" onClick={p.aoFechar}>
          Cancelar
        </Botao>
        <Botao type="submit" carregando={isSubmitting}>
          Salvar (Ctrl+Enter)
        </Botao>
      </div>

      {confirmandoDescarte && (
        <div
          role="alertdialog"
          aria-label="Descartar agendamento?"
          className="grid gap-[var(--s-3)]"
        >
          <span className="text-text">Descartar o que foi digitado?</span>
          <div className="flex gap-[var(--s-3)]">
            <Botao
              variante="secundario"
              type="button"
              onClick={() => setConfirmandoDescarte(false)}
            >
              Continuar editando
            </Botao>
            <Botao variante="fantasma" type="button" onClick={p.aoFechar}>
              Descartar
            </Botao>
          </div>
        </div>
      )}
    </form>
  );

  if (isPopover) {
    return (
      <Popover.Root
        open={p.aberto}
        onOpenChange={(open) => {
          if (!open) fecharComConfirmacao();
        }}
      >
        <Popover.Trigger asChild>{p.children}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="right"
            sideOffset={8}
            className={cn(
              'z-[var(--z-popover)] w-80 rounded-xl border border-line bg-surface shadow-elev-2',
              'data-[state=open]:animate-[scaleIn_150ms_ease]',
              'data-[state=closed]:animate-[fadeOut_100ms_ease]',
            )}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              fecharComConfirmacao();
            }}
          >
            {formulario}
            <Popover.Arrow className="fill-surface" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return formulario;
}
