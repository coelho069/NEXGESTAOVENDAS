# Contas de clientes assinantes e acesso automático pós-compra

Fluxo automático após confirmação de pagamento (Stripe / Mercado Pago) que
provisiona o acesso do cliente e envia um e-mail transacional com link seguro
para definir a senha. A tela administrativa serve para consulta, reenvio e
casos excepcionais de provisionamento manual.

- Tela: `/admin/clientes/contas` (somente `platform_admins.is_active`)
- Ativação: `/ativar-conta` (pública — o link precisa chegar sem sessão)
- Migração: `supabase/migrations/20261004150000_admin_client_accounts.sql`

## Arquitetura

```
/admin/clientes/contas  (Server Component)
  └─ loadCurrentAdminClientAccounts      lê client_accounts + organizations
     │                                    + subscriptions + plans (RLS)
  └─ Client Component (formulário + tabela)
     └─ Server Actions (admin-client-account-actions.ts)
        ├─ getPlatformAdminAccess()       autorização (platform_admins)
        ├─ consumeRateLimit()             20 convites/hora por admin
        └─ admin-client-account-provisioning.ts   (service role)
           ├─ generateLink(type=invite)   cria o usuário sem senha
           ├─ profiles + store_members     vínculo com a organização (RLS)
           ├─ client_accounts             estado da conta
           ├─ gmail-invite-sender.ts      Gmail API (OAuth2)
           └─ client_account_events       auditoria append-only
```

### Estados

Três estados independentes, nunca confundidos:

| Estado | Dono | Onde vive |
| --- | --- | --- |
| Autenticação | Supabase Auth | `auth.users` (`banned`, `email_confirmed_at`) |
| Convite | esta funcionalidade | `client_accounts.status` |
| Financeiro | domínio de cobrança | `subscriptions.status` |

O e-mail automático de onboarding (pós-confirmação de pagamento) sai por
`getEmailSenderConfig` em `src/lib/server/access-email.ts`. Com `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` e `SMTP_PASSWORD` completos, o
transporte é SMTP da Hostinger (`smtp.hostinger.com`, porta 465, TLS
implícito). `SMTP_USER` autentica; `EMAIL_FROM` pode ser outro endereço,
inclusive o alias, e é só o remetente visível. Sem nenhuma variável `SMTP_*`,
o mesmo fluxo usa o Resend (`RESEND_API_KEY` + `EMAIL_FROM`), que ainda recebe
a chave de idempotência. Qualquer `SMTP_*` presente com o conjunto incompleto
não cai no Resend.

Falha de envio com SMTP válido grava `client_accounts.status = invite_failed`
quando a conta já foi sincronizada, e a sessão de checkout fica `failed` para
o webhook tentar de novo. Não há segundo envio pelo Resend nessa falha. O SMTP
não tem chave de idempotência do provedor: se a mensagem for aceita e o
processo cair antes de gravar `onboarding_email_sent_at`, o retry pode enviar
outra cópia. Com esse marcador, ou com a sessão já `completed`, o replay não
reenvia.

Convites manuais do admin continuam em `gmail-invite-sender.ts` (Gmail OAuth)
e não usam este transporte.

`client_accounts.status`: `created`, `invite_pending`, `invite_sent`,
`invite_expired`, `activated`, `invite_failed`, `suspended`.

A expiração é derivada do relógio (`invite_expires_at`), não de uma coluna que
pode ficar obsoleta.

## Configurar o Gmail

O remetente usa a **Gmail REST API** com OAuth2 (sem SMTP e sem SDK novo —
implementado com `fetch`, como `access-email.ts`).

1. Crie um projeto no Google Cloud e ative a **Gmail API**.
2. Configure a tela de consentimento OAuth (interno ou com o e-mail do
   remitente em *test users*).
3. Crie credenciais **OAuth 2.0 Client ID → Web application**.
4. Gere um *refresh token* com o escopo
   `https://www.googleapis.com/auth/gmail.send`
   (por exemplo via OAuth 2.0 Playground, autorizado na conta remetente).
5. No ambiente de servidor, defina:

```
GMAIL_INVITE_ENABLED=true
GMAIL_SENDER_ADDRESS=contato@seudominio.com.br
GMAIL_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REFRESH_TOKEN=...
GMAIL_TIMEOUT_MS=15000
```

6. No Supabase, adicione `<APP_ORIGIN>/ativar-conta` em
   **Authentication → URL Configuration → Redirect URLs**.

Sem `GMAIL_INVITE_ENABLED=true` (ou sem credenciais) a integração fica inerte e
o fluxo retorna `gmail_not_configured` — nunca simula sucesso.

### Rotação de credenciais

1. Gere um novo refresh token.
2. Atualize `GMAIL_OAUTH_REFRESH_TOKEN` no ambiente.
3. Faça o redeploy seguindo `docs/ATOMIC_DEPLOY.md`.
4. Revogue o token antigo no Google Cloud (OAuth 2.0 → credenciais).

O access token de curta duração é mantido **apenas em memória** do processo e
nunca é persistido nem logado.

## Garantias

- **Nenhuma senha é gerada ou enviada.** O convite é um link de uso único do
  Supabase; o cliente define a própria senha em `/ativar-conta`.
- **Idempotência.** O índice único em `lower(email)` impede duas contas para o
  mesmo e-mail. Repetir a requisição apenas reenvia o convite.
- **Falha parcial.** Se o e-mail falhar, a conta é preservada com status
  `invite_failed` e o admin reenvia — nunca nasce um segundo usuário.
- **Isolamento.** Um cliente não pode acessar `/admin` (layout + RLS) nem criar
  contas (autorização no servidor em cada ação).
- **Auditoria.** `client_account_events` é append-only (trigger bloqueia
  UPDATE/DELETE). Não guarda senhas, tokens nem links de ativação.
- **Assinaturas intactas.** Nenhuma rota desta funcionalidade altera estado
  financeiro em `subscriptions` ou `plans`. O provisionamento cria apenas o
  vínculo mínimo em `store_members` (loja `MATRIZ`) para que o cliente passe
  pelas políticas RLS existentes após a ativação.

## Aplicar a migração

```bash
supabase db push          # aplica 20261004150000_admin_client_accounts.sql
pnpm db:types             # regenera src/lib/db/types.ts
```

A migração é **aditiva** (duas tabelas novas, dois enums, políticas). Não altera
tabelas existentes nem dados. Ordem: deve ser aplicada antes do deploy do código
que lê `client_accounts`.

## Clientes antigos (backfill)

Compras confirmadas **antes** desta implementação podem não ter linha em
`client_accounts`, embora já possuam `checkout_sessions.onboarding_status =
completed`.

Procedimento auditável (não executar em massa sem autorização):

1. Listar sessões concluídas:
   ```sql
   SELECT client_mutation_id, payer_email, onboarding_user_id,
          onboarding_organization_id, onboarding_subscription_id
   FROM public.checkout_sessions
   WHERE onboarding_status = 'completed'
     AND payer_email IS NOT NULL;
   ```
2. Para cada linha, verificar se já existe `client_accounts` com `lower(email)`.
3. Se ausente, provisionar via painel admin (exceção) **ou** script de serviço
   que chame `syncClientAccountAfterPurchase` + reenvio de acesso — nunca altere
   `subscriptions.status` nem dados de pagamento históricos.
4. Registrar cada operação em `client_account_events`.

Nunca associe assinatura a e-mail diferente do `payer_email` da sessão sem
confirmação manual.

## Teste manual (sem conta Gmail real em CI)

Os testes automatizados usam mocks (`tests/unit/admin-client-accounts-email.test.ts`,
`tests/unit/admin-client-account-provisioning.test.ts`). Para validar de ponta a
ponta com uma conta real:

1. Use uma conta Gmail de teste e um usuário Supabase de homologação.
2. Configure as variáveis acima em `.env.local` e rode `pnpm dev`.
3. Entre como `platform_admin`, abra `/admin/clientes/contas`.
4. Crie uma conta com um e-mail de teste que você controle.
5. Abra o link recebido, defina a senha e confirme o acesso ao `/pdv`.
6. Verifique o estado em "Conta ativada" e o evento `account_activated`.

## Diagnóstico e reenvio

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| `gmail_not_configured` | `GMAIL_INVITE_ENABLED` ausente ou credenciais incompletas | Configure as variáveis no servidor e redeploy |
| `invite_failed` na tabela | Falha de envio ou link inválido | Use "Reenviar convite" na tela admin — nunca crie outra conta |
| `invite_expired` | Passou o TTL de 24h do convite Supabase | Reenviar convite (gera novo link) |
| Cliente ativa mas PDV nega acesso | `store_members` ausente (corrigido em `ensureTenantAccess`) | Reprovisionar membership manualmente ou recriar via admin |
| Link não retorna ao app | `/ativar-conta` ausente nas Redirect URLs do Supabase | Adicionar `<APP_ORIGIN>/ativar-conta` |

Os logs registram `client_account_id`, `error_code` e eventos de auditoria — **nunca** o link de ativação completo.

## Procedimento de release

Ordem obrigatória (não inverter):

1. **Revisar** a migração `20261004150000_admin_client_accounts.sql`.
2. **Backup** do banco remoto (snapshot Supabase ou `pg_dump`).
3. **Aplicar migração:** `supabase db push` (ou pipeline equivalente).
4. **Regenerar tipos** se necessário: `pnpm db:types`.
5. **Deploy atômico** conforme `docs/ATOMIC_DEPLOY.md`:
   - `systemctl stop nexgestao.service`
   - `pnpm build` (inclui `nex-standalone-finalize.sh`)
   - `bash scripts/nex-atomic-deploy-check.sh`
   - `systemctl start nexgestao.service`
   - readiness check em `http://127.0.0.1:3211/health/readiness`
6. **Verificar rotas:** `/`, `/planos`, `/login`, `/ativar-conta`, `/admin/clientes/contas`.
7. **Configurar Gmail** no ambiente de produção (credenciais novas, rotacionadas).
8. **Teste manual** com um e-mail de homologação (não em CI).

### Rollback

- **Código:** reverter para o commit anterior e redeploy atômico.
- **Banco:** a migração é aditiva; rollback de schema exige script manual (não destrutivo por padrão).
- **Gmail:** revogar refresh token comprometido no Google Cloud.

Nunca sobrescrever o `.next` ativo sem parar o serviço primeiro.
