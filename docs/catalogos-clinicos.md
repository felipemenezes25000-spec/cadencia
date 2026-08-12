# Catálogos clínicos: carga e verificação

As migrations criam a estrutura versionada dos catálogos, mas não embutem
terminologias externas. CID-10 e CID-11 devem ser carregadas por jobs
operacionais depois da migração do banco.

Enquanto uma tabela estiver vazia, a API responde
`503 catalogo_nao_carregado`. Isso impede que a interface confunda uma
dependência ausente com uma busca válida sem resultados.

## CID-10

Fonte oficial: [DATASUS — CID-10, versão 2008][datasus-cid10].

1. Baixe o pacote CSV oficial e extraia `CID-10-SUBCATEGORIAS.CSV`.
2. Valide o arquivo sem gravar:

   ```bash
   pnpm cid10:load -- --arquivo /dados/CID-10-SUBCATEGORIAS.CSV --dry-run
   ```

3. Configure `DATABASE_URL_JOBS` e execute a carga:

   ```bash
   pnpm cid10:load -- --arquivo /dados/CID-10-SUBCATEGORIAS.CSV
   ```

O leitor usa Windows-1252, separador ponto-e-vírgula e rejeita arquivos com
menos de 10.000 subcategorias válidas. A competência padrão é `200801` e a
vigência padrão começa em `2008-01-01`.

## CID-11

Fonte oficial: [API da CID-11 da OMS][who-api].

O release da OMS e a vigência clínica brasileira são conceitos separados. Por
padrão, o release `2025-01` é gravado com vigência a partir de
`2027-01-01`.

Com uma instância local do container da OMS:

```bash
pnpm icd:up
pnpm cid11:load -- --release 2025-01 --vigencia-de 2027-01-01
```

Para usar o endpoint público, configure `ICD_BASE_URL=https://id.who.int`,
`ICD_CLIENT_ID` e `ICD_CLIENT_SECRET`.

## Verificação

```sql
SELECT 'CID10' AS catalogo, count(*) FROM ref.cid10_term
UNION ALL
SELECT 'CID11', count(*) FROM ref.cid11_term
UNION ALL
SELECT 'TUSS', count(*) FROM ref.tuss_term;
```

Depois da carga, consulte `/catalogos/cid10` e `/catalogos/cid11` usando a
data de referência exibida na própria página.

[datasus-cid10]: https://www2.datasus.gov.br/cid10/V2008/download.htm
[who-api]: https://icd.who.int/icdapi
