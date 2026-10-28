# LGPD — MVP operacional (Nex)

Status: melhorias de produto para ajudar a loja a cumprir pedidos de titulares. **Não** substitui parecer jurídico, DPO nomeado, RIPD ou política de retenção automática.

## O que existe agora

- Aviso público: `/politica-de-privacidade` (aliases `/privacidade`, `/lgpd`, `/privacy`)
- Links no rodapé da landing e na política de reembolso
- Configurações → aba **Privacidade (LGPD)** (guia operacional)
- Clientes → detalhe: **Exportar dados (LGPD)** e **Anonimizar cadastro**
- Marketing: selo ajustado para “Ferramentas LGPD” (sem “conforme” absoluto)

## O que ainda precisa de humano/advogado

- Texto definitivo da política e bases legais por operação
- Nomeação de encarregado (DPO) e canal formal
- CNPJ/razão social públicos (`NEXT_PUBLIC_COMPANY_*`)
- Retenção automática / purge agendado (backlog)
- UI de auditoria de acesso a dados pessoais (backlog; `audit_logs` existe no backend para eventos de venda/estoque)

## Referências internas

- Backlog histórico: `docs/BLOQUEADOR-13-GO-LIVE-READINESS.md` (LGPD DSAR)
