import { describe, expect, it } from 'vitest';
import { createTissSoapTransport } from './tiss-soap';
import { assertSafetyDeclared } from '@cadencia/integrations';

describe('TissSoapTransport', () => {
  describe('criacao (factory)', () => {
    it('retorna SoapNotConfigured se soapEndpointUrl ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapUsername ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: '',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapPassword ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: 'user',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured com detail descritivo', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: '',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.detail).toContain('SOAP');
    });

    it('retorna Ok com transport valido quando credenciais presentes', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
    });

    it('transport tem id "tiss-soap" e mode "webservice"', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('tiss-soap');
      expect(result.value.mode).toBe('webservice');
    });

    it('tissVersion reflete o valor passado', () => {
      const result = createTissSoapTransport({
        tissVersion: '3.05.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tissVersion).toBe('3.05.00');
    });

    it('safety declara os tres metodos publicos', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(assertSafetyDeclared(
        result.value,
        ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'],
      )).toBe(true);
    });

    it('capabilities inclui residency:br e tiss-soap', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capabilities.has('residency:br')).toBe(true);
      expect(result.value.capabilities.has('tiss-soap')).toBe(true);
    });

    it('health retorna up: true', async () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const h = await result.value.health();
      expect(h.up).toBe(true);
      expect(h.checkedAt).toBeDefined();
    });
  });
});
