# Contas de clientes assinantes e convites por e-mail (Gmail)

Fluxo administrativo para provisionar o acesso de clientes assinantes do
NEXGESTAOVENDAS e enviar um convite de ativação por e-mail.

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
           ├─ profiles                    vínculo com a organização
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
- **Assinaturas intactas.** Nenhuma rota desta funcionalidade escreve em
  `subscriptions`, `plans`, `store_members` ou `platform_admins`.

## Aplicar a migração

```bash
supabase db push          # aplica 20261004150000_admin_client_accounts.sql
pnpm db:types             # regenera src/lib/db/types.ts
```

A migração é **aditiva** (duas tabelas novas, dois enums, políticas). Não altera
tabelas existentes nem dados. Ordem: deve ser aplicada antes do deploy do código
que lê `client_accounts`.

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

## Procedimento de release

Seguir `docs/ATOMIC_DEPLOY.md`. Nesta etapa **não houve commit, push nem deploy**.
