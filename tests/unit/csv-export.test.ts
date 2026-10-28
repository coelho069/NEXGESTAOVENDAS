import { describe, expect, it } from "vitest";
import { csvCell, csvQuotedCell, neutralizeCsvFormula } from "@/lib/domain/csv-export";
import { toExportCsv } from "@/lib/domain/inventory";

describe("neutralizeCsvFormula — entradas maliciosas", () => {
  it.each([
    ["=HYPERLINK(\"http://x\",\"a\")", "'=HYPERLINK(\"http://x\",\"a\")"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["  =1+1", "'  =1+1"],
    ["\t=1+1", "'\t=1+1"],
    ["\u0001=1+1", "'\u0001=1+1"],
  ])("prefixa %j", (input, expected) => {
    expect(neutralizeCsvFormula(input)).toBe(expected);
  });
});

describe("neutralizeCsvFormula — valores legítimos", () => {
  it.each(["-12.50", "-5", "+3", "0.00", "1250", "-0.01", "12,50", "-3,75"])(
    "mantém número %s intacto",
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(value);
    }
  );

  it.each(["Café 500g", "Água Mineral", "SKU-001", "BEV/001", "Cerveja (lata)"])(
    "mantém texto comum %j intacto",
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(value);
    }
  );
});

describe("csvCell — escape de aspas, vírgulas e quebras", () => {
  it("entrega null e undefined como vazio", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("converte número sem alterar o valor", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(0)).toBe("0");
  });

  it("entre aspas quando há vírgula, aspas ou quebra de linha, com aspas duplicadas", () => {
    expect(csvCell('Agua, "Mineral"')).toBe('"Agua, ""Mineral"""');
    expect(csvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("sem caracteres especiais não usa aspas", () => {
    expect(csvCell("BEV-001")).toBe("BEV-001");
  });

  it("neutraliza e escapa juntos: fórmula com vírgula", () => {
    expect(csvCell('=SUM(A1,"x")')).toBe('"\'=SUM(A1,""x"")"');
  });
});

describe("csvQuotedCell — campo de texto sempre entre aspas", () => {
  it("cita texto comum e neutraliza fórmula", () => {
    expect(csvQuotedCell("Café 500g")).toBe('"Café 500g"');
    expect(csvQuotedCell("=cmd")).toBe('"\'=cmd"');
    expect(csvQuotedCell('Agua "Mineral"')).toBe('"Agua ""Mineral"""');
  });
});

describe("toExportCsv — integração", () => {
  it("neutraliza SKU e nome maliciosos sem alterar linhas legítimas", () => {
    const csv = toExportCsv([
      { sku: "=cmd", name: '=HYPERLINK("http://evil","x")', quantity: 3, unitPrice: "3.50" },
      { sku: "BEV-002", name: "Água, 500ml", quantity: 1, unitPrice: "2.00" },
    ]);
    const [header, malicious, legit] = csv.split("\n");
    expect(header).toBe("sku,name,quantity,unit_price,cost_price");
    // quantidade mantém o formato de inventário de HEAD (três casas decimais)
    expect(malicious).toBe(`'=cmd,"'=HYPERLINK(""http://evil"",""x"")",3.000,3.50,`);
    expect(legit).toBe('BEV-002,"Água, 500ml",1.000,2.00,');
  });

  it("preserva custo negativo legítimo como número", () => {
    const csv = toExportCsv([
      { sku: "X-1", name: "Produto", quantity: 1, unitPrice: "1.00", costPrice: "-0.50" },
    ]);
    expect(csv.split("\n")[1]).toBe('X-1,"Produto",1.000,1.00,-0.50');
  });
});
