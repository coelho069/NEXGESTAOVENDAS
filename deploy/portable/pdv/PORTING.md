# PORTING.md — Levar o PDV para o projeto real do NEX

> ## PORTING.md — referência, não a rota
>
> **Decisão:** a tela canônica do caixa é `src/components/pdv/pdv-screen.tsx`.
> A rota `/pdv` importa esse módulo. **Não montar o `PdvScreen` desta pasta.**
>
> - Este diretório fica como **kit de referência**. Não copiar para `src/features/pdv`.
> - UI nova entra em `src/components/pdv`, no mesmo commit.

Estes arquivos são **portáveis e self-contained** (React + TypeScript + inline
styles via tokens). Nenhuma regra fiscal, migration ou endpoint foi criado.

## Mapa de arquivos

```
portable/pdv/
├── PdvScreen.tsx              # tela completa (orquestração)
├── theme/pdv-theme.ts         # tokens (cores, raios, fontes, touch targets)
├── lib/
│   ├── types.ts               # contratos espelhando public.products (Supabase)
│   ├── money.ts               # centavos inteiros + BRL + normalização
│   └── pdv-catalog.ts         # SELECT products + fallback offline explícito
├── hooks/
│   ├── use-pdv-cart.ts        # estado do cupom (UI only)
│   └── use-pdv-atalhos.ts     # F2/F4/F8/F9/F12/Esc
└── components/
    ├── BarraBuscaPdv.tsx      # foco persistente + bip + dropdown
    ├── GradeAtalhos.tsx       # produtos frequentes, 1 toque
    ├── ListaCupom.tsx         # linhas 52px, qty inline
    ├── PainelTotais.tsx       # total 56px + badge OFFLINE
    ├── TecladoNumerico.tsx    # teclado de caixa 64px
    └── SheetPagamento.tsx     # mistos + troco
```

## Passos de integração

1. **Copie a pasta** `portable/pdv` para `src/features/pdv` (ou equivalente).

2. **Forneça o cliente Supabase** do projeto real (que já tem as policies de
   SELECT criadas pela migration `20260925120000`):

   ```tsx
   'use client';
   import { createClient } from '@supabase/supabase-js';
   import { PdvScreen } from '@/features/pdv/PdvScreen';

   const supabase = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   export default function Page() {
     return (
       <PdvScreen
         supabaseClient={supabase}
         onVendaConfirmada={({ totalCentavos, pagamentos }) => {
           // >>> chame aqui a camada de persistência fiscal existente (NFC-e).
           // Este componente NÃO grava nada por conta própria.
         }}
       />
     );
   }
   ```

3. **Tipagem do cliente**: o `SupabaseLike` em `pdv-catalog.ts` é uma interface
   estrutural — o client do `@supabase/supabase-js` satisfaz o subconjunto
   usado (`.from('products').select().or()/.limit()`). Se o projeto real usa
   tipos gerados, faça cast direto.

4. **Spec v2 — mapa de atalhos**: F2 busca · F4 modo quantidade · F8 modo
   desconto inline · F9 cancelar item · F12 finalizar · Esc fecha/desarma.
   O F12 é sequestrado (preventDefault) — em dev isso bloqueia DevTools; o
   guard `import.meta.env.DEV` foi removido por exigência da spec.

5. **Desconto**: o carrinho aceita desconto em centavos limitado ao subtotal;
   o total exibido é `subtotal − desconto`. O callback `onVendaConfirmada`
   recebe `{ totalCentavos, descontoCentavos, pagamentos }` — o host decide
   como enviar o desconto à camada fiscal (fora deste pacote).

4. **Tailwind (opcional)**: os componentes usam inline styles com os tokens
   para serem 100% portáveis. Se quiser classes, mapeie `pdvTheme.color.*`
   para as variáveis do seu `tailwind.config` e substitua gradualmente.

## Garantias preservadas (checklist de não-regressão)

- [x] Zero endpoints novos — apenas SELECT em `public.products`.
- [x] Zero escrita no banco a partir da UI — venda confirmada é callback.
- [x] Cálculo fiscal/NFC-e/SEFAZ: intocado (fora destes arquivos).
- [x] Contraste AA (#0B0E11 base), `tabular-nums` em toda cifra.
- [x] Alvos de toque: ≥44px (geral), ≥56px (pagamento), linhas 52px.
- [x] Total a Pagar: maior elemento da tela, sem scroll (coluna sticky).
- [x] Estado offline explícito ("OFFLINE · N PENDENTES" + fallback de seed).
- [x] Atalhos F2/F4/F8/F9/F12/Esc com `preventDefault`.

## Nota sobre `import.meta.env`

`use-pdv-atalhos.ts` usa `import.meta.env?.DEV` apenas para NÃO sequestrar o
F12 em desenvolvimento (F12 = DevTools). Em build de produção/kiosk o atalho
funciona. Se o host não usa Vite/Next com `import.meta.env`, troque por uma
const `IS_DEV` do seu bundler — o guard é independente do resto.
