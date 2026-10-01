# Log Operacional — Jornada do Caixa (Antes vs. Depois)

> Baseline "Antes": PDV genérico com modal de item, total abaixo da dobra e
> sem indicador de conexão. "Depois": esta refatoração. Nenhuma regra fiscal
> ou contrato de API foi alterado.

## 1. Adicionar item ao cupom

| Passo | Antes | Depois |
|---|---|---|
| 1 | Bipe o código na busca | Bipe o código na busca (F2 já focado) |
| 2 | Modal "detalhes do produto" abre | — |
| 3 | Clicar "Confirmar" no modal | — |
| **Toques pós-código** | **2** | **0** |

## 2. Produto frequente (cliente pega item do balcão)

| Antes | Depois |
|---|---|
| Buscar pelo nome → achar → abrir modal → confirmar (4–6 interações) | 1 toque no cartão da GradeAtalhos |

## 3. Ajustar quantidade

| Antes | Depois |
|---|---|
| Reabrir modal do item → digitar qty → salvar (3+ passos, risco de apagar) | Botões − / + inline na linha (1 toque cada); piso em 1 un.; remover é gesto separado (✕ / Delete) |

## 4. Fechar a venda / pagar

| Antes | Depois |
|---|---|
| Localizar botão "Finalizar" → tela nova → procurar forma → digitar valor com vírgula → confirmar (5+ passos) | F9 → forma (1 toque) → valor no teclado de caixa (dígitos = centavos) → "ADICIONAR" → CONFIRMAR habilita SÓ com saldo zerado |

## 5. Pagamento misto (parte dinheiro, parte Pix)

| Antes | Depois |
|---|---|
| Não suportado sem recomeçar a venda | Registrar forma 1 + valor → forma 2 + valor → CONFIRMAR. Saldo/Troco recalculados em centavos a cada toque |

## 6. Conexão cai no meio do atendimento

| Antes | Depois |
|---|---|
| Tela genérica de erro; caixa não sabe se vendeu | Badge âmbar "OFFLINE · N PENDENTES" fixo no PainelTotais; catálogo segue do cache/seed; F12 re-sincroniza quando a rede volta |

## 7. Legibilidade e erros de toque

| Métrica | Antes | Depois |
|---|---|---|
| Total a Pagar | 18–20px, competindo com o cupom | 56px/800 — maior elemento da tela, `tabular-nums` |
| Alvo dos botões críticos | ~32–36px | ≥ 44px; pagamento/teclado ≥ 56–64px |
| Linha do cupom | Altura variável, números proporcionais | 52px fixos, coluna de valores alinhada à direita |
| Contraste | Tema claro, glare sob solário | Escuro Industrial #0B0E11, pares AA (≥ 4.5:1) |
| Foco do teclado | Perdido após qualquer clique | Foco persistente na busca; F2 devolve; área morta devolve |

## Atalhos (inalterados entre sessões — memória muscular)

| Tecla | Ação |
|---|---|
| F2 | Focar busca (com select do texto) |
| F4 | Focar grade de atalhos |
| F8 | Focar cupom |
| F9 | Abrir pagamento |
| F12 | Sincronizar catálogo/conexão |
| Esc | Fechar sheet · limpar busca |
| Delete | Remover linha focada do cupom |
