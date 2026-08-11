import type { Appointment } from '../domain/appointments/types';

export interface Patient {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly age: number;
  readonly gender: string;
  readonly cpf: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly insurer: string;
  readonly plan: string;
  readonly clientSince: number;
  readonly allergies: readonly string[];
  readonly medications: readonly string[];
}

export interface WorkItem {
  readonly id: string;
  readonly priority: 'Alta' | 'Média' | 'Baixa';
  readonly title: string;
  readonly context: string;
}

export interface CalendarEventData {
  readonly id: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly shortName: string;
  readonly professional: string;
  readonly day: number;
  readonly start: number;
  readonly duration: number;
  readonly time: string;
  readonly procedure: string;
  readonly insurer: string;
  readonly status: Appointment['status'];
  readonly tone: 'blue' | 'green' | 'amber' | 'violet';
}

export interface FinanceEntry {
  readonly id: string;
  readonly patientName: string;
  readonly description: string;
  readonly encounterDate: string;
  readonly dueDate: string;
  readonly amount: number;
  readonly insurer: string;
  readonly status: 'due' | 'paid' | 'overdue' | 'cancelled';
}

/**
 * Fixtures exclusivamente sintéticos para demonstração visual.
 * Nenhum nome, contato, documento ou dado clínico representa uma pessoa real.
 */
const demoIdentities = {
  p1: { name: 'Paciente Demo 01', initials: 'D1' },
  p2: { name: 'Paciente Demo 02', initials: 'D2' },
  p3: { name: 'Paciente Demo 03', initials: 'D3' },
  p4: { name: 'Paciente Demo 04', initials: 'D4' },
  p5: { name: 'Paciente Demo 05', initials: 'D5' },
  p6: { name: 'Paciente Demo 06', initials: 'D6' },
  p7: { name: 'Paciente Demo 07', initials: 'D7' },
  p8: { name: 'Paciente Demo 08', initials: 'D8' },
} as const;

const demoCpf = '***.***.***-**';
const demoPhone = '(00) 00000-0000';
const demoAddress = 'Endereço fictício · Unidade Demo';
const demoInsurerA = 'Convênio Demo A';
const demoInsurerB = 'Convênio Demo B';

export const patients: readonly Patient[] = [
  {
    id: 'PAC-001', ...demoIdentities.p1, age: 28,
    gender: 'Masculino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-01@example.invalid', address: demoAddress,
    insurer: demoInsurerA, plan: 'Plano demonstrativo A', clientSince: 2022,
    allergies: ['Substância demonstrativa A'], medications: ['Medicação demonstrativa A'],
  },
  {
    id: 'PAC-002', ...demoIdentities.p2, age: 41,
    gender: 'Feminino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-02@example.invalid', address: demoAddress,
    insurer: demoInsurerA, plan: 'Plano demonstrativo B', clientSince: 2021,
    allergies: [], medications: ['Medicação demonstrativa B'],
  },
  {
    id: 'PAC-003', ...demoIdentities.p3, age: 38,
    gender: 'Masculino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-03@example.invalid', address: demoAddress,
    insurer: demoInsurerB, plan: 'Plano demonstrativo C', clientSince: 2024,
    allergies: ['Substância demonstrativa B'], medications: [],
  },
  {
    id: 'PAC-004', ...demoIdentities.p4, age: 42,
    gender: 'Feminino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-04@example.invalid', address: demoAddress,
    insurer: 'Particular', plan: 'Particular', clientSince: 2023,
    allergies: [], medications: ['Medicação demonstrativa C'],
  },
  {
    id: 'PAC-005', ...demoIdentities.p5, age: 45,
    gender: 'Masculino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-05@example.invalid', address: demoAddress,
    insurer: demoInsurerA, plan: 'Plano demonstrativo A', clientSince: 2020,
    allergies: [], medications: [],
  },
  {
    id: 'PAC-006', ...demoIdentities.p6, age: 31,
    gender: 'Feminino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-06@example.invalid', address: demoAddress,
    insurer: demoInsurerB, plan: 'Plano demonstrativo B', clientSince: 2025,
    allergies: [], medications: [],
  },
  {
    id: 'PAC-007', ...demoIdentities.p7, age: 29,
    gender: 'Masculino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-07@example.invalid', address: demoAddress,
    insurer: 'Particular', plan: 'Particular', clientSince: 2026,
    allergies: [], medications: [],
  },
  {
    id: 'PAC-008', ...demoIdentities.p8, age: 46,
    gender: 'Feminino', cpf: demoCpf, phone: demoPhone,
    email: 'paciente-08@example.invalid', address: demoAddress,
    insurer: demoInsurerA, plan: 'Plano demonstrativo C', clientSince: 2019,
    allergies: ['Substância demonstrativa C'], medications: ['Medicação demonstrativa D'],
  },
];

export const appointments: readonly Appointment[] = [
  {
    id: 'APT-001', encounterId: 'ATD-001', patientId: 'PAC-001', time: '08:00',
    durationMinutes: 30, patientName: demoIdentities.p1.name, patientInitials: demoIdentities.p1.initials,
    patientAge: 28, patientGender: 'Masculino', professional: 'Dra. Helena Vasques',
    procedure: 'Consulta', insurer: demoInsurerA, status: 'in_progress',
    waitMinutes: null, room: 'Sala 1', telemedicine: false, alert: null,
  },
  {
    id: 'APT-002', encounterId: 'ATD-002', patientId: 'PAC-002', time: '08:30',
    durationMinutes: 30, patientName: demoIdentities.p2.name, patientInitials: demoIdentities.p2.initials,
    patientAge: 41, patientGender: 'Feminino', professional: 'Dr. Rafael Andrade',
    procedure: 'Retorno', insurer: demoInsurerA, status: 'waiting',
    waitMinutes: 23, room: 'Sala 3', telemedicine: false, alert: null,
  },
  {
    id: 'APT-003', encounterId: 'ATD-003', patientId: 'PAC-003', time: '09:00',
    durationMinutes: 40, patientName: demoIdentities.p3.name, patientInitials: demoIdentities.p3.initials,
    patientAge: 38, patientGender: 'Masculino', professional: 'Dra. Helena Vasques',
    procedure: 'Procedimento', insurer: demoInsurerB, status: 'waiting',
    waitMinutes: 18, room: 'Sala 2', telemedicine: false,
    alert: 'Guia aguardando autorização da operadora',
  },
  {
    id: 'APT-004', encounterId: 'ATD-004', patientId: 'PAC-004', time: '09:30',
    durationMinutes: 30, patientName: demoIdentities.p4.name, patientInitials: demoIdentities.p4.initials,
    patientAge: 42, patientGender: 'Feminino', professional: 'Dr. Rafael Andrade',
    procedure: 'Teleconsulta', insurer: 'Particular', status: 'in_progress',
    waitMinutes: 6, room: null, telemedicine: true, alert: null,
  },
  {
    id: 'APT-005', encounterId: 'ATD-005', patientId: 'PAC-005', time: '10:00',
    durationMinutes: 30, patientName: demoIdentities.p5.name, patientInitials: demoIdentities.p5.initials,
    patientAge: 45, patientGender: 'Masculino', professional: 'Dra. Helena Vasques',
    procedure: 'Consulta', insurer: demoInsurerA, status: 'confirmed',
    waitMinutes: null, room: 'Sala 1', telemedicine: false, alert: null,
  },
  {
    id: 'APT-006', encounterId: 'ATD-006', patientId: 'PAC-006', time: '10:30',
    durationMinutes: 30, patientName: demoIdentities.p6.name, patientInitials: demoIdentities.p6.initials,
    patientAge: 31, patientGender: 'Feminino', professional: 'Dr. Rafael Andrade',
    procedure: 'Retorno', insurer: demoInsurerB, status: 'confirmed',
    waitMinutes: null, room: 'Sala 2', telemedicine: false, alert: null,
  },
  {
    id: 'APT-007', encounterId: 'ATD-007', patientId: 'PAC-007', time: '11:00',
    durationMinutes: 45, patientName: demoIdentities.p7.name, patientInitials: demoIdentities.p7.initials,
    patientAge: 29, patientGender: 'Masculino', professional: 'Dra. Helena Vasques',
    procedure: 'Procedimento', insurer: 'Particular', status: 'scheduled',
    waitMinutes: null, room: 'Sala 1', telemedicine: false, alert: null,
  },
  {
    id: 'APT-008', encounterId: 'ATD-008', patientId: 'PAC-008', time: '11:30',
    durationMinutes: 30, patientName: demoIdentities.p8.name, patientInitials: demoIdentities.p8.initials,
    patientAge: 46, patientGender: 'Feminino', professional: 'Dr. Rafael Andrade',
    procedure: 'Teleconsulta', insurer: demoInsurerA, status: 'scheduled',
    waitMinutes: null, room: null, telemedicine: true, alert: null,
  },
];

export const workItems: readonly WorkItem[] = [
  { id: 'WRK-001', priority: 'Alta', title: '2 confirmações sem resposta', context: 'Resolver antes das 10:30' },
  { id: 'WRK-002', priority: 'Alta', title: 'Autorizar guia do Paciente Demo 03', context: `${demoInsurerB} · Procedimento` },
  { id: 'WRK-003', priority: 'Média', title: 'Revisar resultado demonstrativo', context: 'Paciente Demo · Exame demonstrativo' },
  { id: 'WRK-004', priority: 'Baixa', title: 'Fechar rascunho de ontem', context: 'Prontuário · 14 min em aberto' },
  { id: 'WRK-005', priority: 'Baixa', title: 'Enviar retorno pós-consulta', context: demoIdentities.p2.name },
];

export const calendarEvents: readonly CalendarEventData[] = [
  { id: 'CAL-001', patientId: 'PAC-001', patientName: demoIdentities.p1.name, shortName: 'Paciente Demo 01', professional: 'Dra. Helena Vasques', day: 1, start: 60, duration: 60, time: '09:00', procedure: 'Consulta', insurer: demoInsurerA, status: 'confirmed', tone: 'blue' },
  { id: 'CAL-002', patientId: 'PAC-002', patientName: demoIdentities.p2.name, shortName: 'Paciente Demo 02', professional: 'Dr. Rafael Andrade', day: 2, start: 150, duration: 60, time: '10:30', procedure: 'Retorno', insurer: demoInsurerA, status: 'confirmed', tone: 'green' },
  { id: 'CAL-003', patientId: 'PAC-004', patientName: demoIdentities.p4.name, shortName: 'Paciente Demo 04', professional: 'Dra. Juliana Portela', day: 3, start: 120, duration: 60, time: '10:00', procedure: 'Teleconsulta', insurer: 'Particular', status: 'in_progress', tone: 'blue' },
  { id: 'CAL-004', patientId: 'PAC-003', patientName: demoIdentities.p3.name, shortName: 'Paciente Demo 03', professional: 'Dr. Gustavo Bezerra', day: 4, start: 180, duration: 75, time: '11:00', procedure: 'Procedimento', insurer: demoInsurerB, status: 'blocked', tone: 'amber' },
  { id: 'CAL-005', patientId: 'PAC-006', patientName: demoIdentities.p6.name, shortName: 'Paciente Demo 06', professional: 'Dra. Ana Souza', day: 3, start: 300, duration: 60, time: '13:00', procedure: 'Retorno', insurer: demoInsurerB, status: 'confirmed', tone: 'green' },
  { id: 'CAL-006', patientId: 'PAC-005', patientName: demoIdentities.p5.name, shortName: 'Paciente Demo 05', professional: 'Dra. Helena Vasques', day: 1, start: 270, duration: 60, time: '12:30', procedure: 'Consulta', insurer: demoInsurerA, status: 'scheduled', tone: 'blue' },
  { id: 'CAL-007', patientId: 'PAC-008', patientName: demoIdentities.p8.name, shortName: 'Paciente Demo 08', professional: 'Dr. Rafael Andrade', day: 5, start: 360, duration: 60, time: '14:00', procedure: 'Teleconsulta', insurer: demoInsurerA, status: 'scheduled', tone: 'violet' },
];

export const financeEntries: readonly FinanceEntry[] = [
  { id: 'FIN-001', patientName: 'Paciente Financeiro Demo 01', description: 'Consulta', encounterDate: '15/08/2026', dueDate: '15/08/2026', amount: 160, insurer: 'Particular', status: 'due' },
  { id: 'FIN-002', patientName: 'Paciente Financeiro Demo 02', description: 'Procedimento', encounterDate: '10/08/2026', dueDate: '18/08/2026', amount: 320, insurer: demoInsurerA, status: 'due' },
  { id: 'FIN-003', patientName: 'Paciente Financeiro Demo 03', description: 'Exame demonstrativo', encounterDate: '05/08/2026', dueDate: '05/08/2026', amount: 153, insurer: demoInsurerB, status: 'overdue' },
  { id: 'FIN-004', patientName: 'Paciente Financeiro Demo 04', description: 'Consulta', encounterDate: '01/08/2026', dueDate: '01/08/2026', amount: 160, insurer: 'Particular', status: 'overdue' },
  { id: 'FIN-005', patientName: 'Paciente Financeiro Demo 05', description: 'Retorno', encounterDate: '29/07/2026', dueDate: '29/07/2026', amount: 210, insurer: demoInsurerB, status: 'paid' },
];

export const mockRepository = {
  listAppointments: () => appointments,
  getAppointment: (id: string) => appointments.find((item) => item.encounterId === id) ?? appointments[0],
  listPatients: () => patients,
  getPatient: (id: string) => patients.find((patient) => patient.id === id) ?? patients[0],
  listWorkItems: () => workItems,
  listCalendarEvents: () => calendarEvents,
  listFinanceEntries: () => financeEntries,
};
