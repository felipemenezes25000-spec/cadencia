import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { appointments } from '../../data/mockRepository';
import { AppointmentRow } from './AppointmentRow';

describe('AppointmentRow', () => {
  it('exibe contexto, estado e exatamente uma CTA primaria', () => {
    const appointment = appointments.find((item) => item.status === 'waiting');
    expect(appointment).toBeDefined();
    if (!appointment) return;
    render(<AppointmentRow appointment={appointment} onOpenPatient={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByText(appointment.patientName)).toBeInTheDocument();
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Chamar' })).toHaveLength(1);
  });

  it('nao possui violacoes basicas de acessibilidade', async () => {
    const appointment = appointments[0];
    expect(appointment).toBeDefined();
    if (!appointment) return;
    const { container } = render(<AppointmentRow appointment={appointment} onOpenPatient={vi.fn()} onPrimary={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
