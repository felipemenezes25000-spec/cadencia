-- 0184_msg_template_channels.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- automation_rule e channel_identity aceitam whatsapp, sms e email desde a
-- Fase 2, mas msg.template ficou preso a whatsapp. A API já expõe identidade
-- de canal no cadastro do template; sem esta correção, template de SMS/email
-- passa pela validação HTTP e explode no CHECK do PostgreSQL.

BEGIN;

ALTER TABLE msg.template
  DROP CONSTRAINT IF EXISTS template_channel_check;

ALTER TABLE msg.template
  ADD CONSTRAINT template_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'email'));

COMMIT;
