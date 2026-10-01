# PORTING.md — referência, não a rota

A tela canônica do caixa é `src/components/pdv/pdv-screen.tsx`.
A rota `/pdv` (`src/app/pdv/page.tsx`) importa esse módulo.

**Não montar o `PdvScreen` desta pasta.** Não copiar este diretório para
`src/features/pdv`. UI nova entra em `src/components/pdv`.

Estes arquivos são **portáveis e self-contained** (React + TypeScript + inline
styles via tokens). Nenhuma regra fiscal, migration ou endpoint foi criado.

## O que vale no src/

- Atalhos: F2 busca, F4 quantidade, F8 desconto, F9 cancelar item com
  confirmação, F12 finalizar, Esc fecha. F6 cliente e F10 Pix são extras.
- Sheet de pagamento, grade 1.2fr/0.8fr, foco volta para a busca, Finalizar
  com no mínimo 56px.
- Persistência: IndexedDB + `POST /api/sales/process` → `process_sale`, com
  `client_mutation_id`.
- Só dinheiro fecha a venda. Pix, débito e crédito permanecem `not_configured`.

## O que este kit não substitui

Cliente, venda suspensa, conflito de sync, recibo, devolução e o badge da
fila Dexie já vivem em `src/components/pdv/`.

## Mapa (referência)

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

---
Este diretório é material de referência. Não existe procedimento de integração:
a rota `/pdv` já usa a tela canônica de `src/components/pdv/`, e UI nova do
caixa entra lá — não via cópia deste kit.

