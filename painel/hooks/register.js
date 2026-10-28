export function register(on, options) {
  const PANE = "painel";

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "painel",
      description: "Abre o painel de agentes e subagentes",
    });
    await $.ui.open({ id: PANE, title: "Painel de Agentes" });
    return next(e);
  });

  on("command.run", { command: "painel" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Painel de Agentes" });
    return { text: "Painel de agentes aberto com sucesso." };
  });

  on("tool.call", { tool: "Agent" }, async ($, e, next) => {
    await $.ui.log(`Subagente acionado: ${e.subagentType || e.tool || "geral"}`);
    const ran = await next(e);
    await $.ui.invalidate();
    return ran;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    return Box(
      { flexDirection: "column", padding: 1 },
      Text({ bold: true }, "🤖 Painel de Agentes e Subagentes Ativos"),
      Text({ dimColor: true }, "Painel de monitoramento ativo.")
    );
  });
}
