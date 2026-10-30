import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(here, "public")));

const DATA_URL = "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv";
const BULARIO_URL = "https://www.gov.br/anvisa/pt-br/sistemas/bulario-eletronico";
let catalog = null;
let lastUpdate = 0;
let loading = null;

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) { cells.push(value.trim()); value = ""; }
    else value += ch;
  }
  cells.push(value.trim());
  return cells;
}
async function loadCatalog() {
  if (catalog && Date.now() - lastUpdate < 6 * 60 * 60 * 1000) return catalog;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch(DATA_URL, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("Base da Anvisa indisponível.");
    const buffer = await response.arrayBuffer();
    const csv = new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("Base vazia.");
    const headers = parseCsvLine(lines[0]).map(h => normalize(h).replace(/ /g, "_"));
    catalog = lines.slice(1).map(line => {
      const cells = parseCsvLine(line);
      const row = {};
      headers.forEach((key, index) => { row[key] = cells[index] || ""; });
      return row;
    }).filter(row => Object.values(row).some(Boolean));
    lastUpdate = Date.now();
    return catalog;
  })();
  try { return await loading; } finally { loading = null; }
}

app.get("/api/health", (_req, res) => res.json({
  ok: true, fonte: "Anvisa - Dados Abertos", catalogoCarregado: Boolean(catalog)
}));

app.post("/api/search", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  if (!query) return res.status(400).json({ error: "Digite o nome do medicamento." });
  if (query.length > 180) return res.status(400).json({ error: "Busca muito longa." });

  try {
    const rows = await loadCatalog();
    const needle = normalize(query);
    const terms = needle.split(" ").filter(term => term.length > 1);
    const matches = [];
    for (const row of rows) {
      const nome = row.nome_produto || "";
      const ativo = row.principio_ativo || "";
      const searchable = normalize(nome + " " + ativo);
      if (!searchable.includes(needle) && !terms.every(term => searchable.includes(term))) continue;
      matches.push({
        nome: nome || "Não informado",
        ativo: ativo || "Não informado",
        registro: row.numero_registro_produto || "Não informado",
        empresa: row.empresa_detentora_registro || row.razao_social || "Não informado"
      });
      if (matches.length >= 20) break;
    }

    if (!matches.length) {
      return res.json({ answer:
        "**Medicamento:** não localizado na base consultada.\n\n" +
        "**Indicação:** não confirmada.\n\n**Posologia:** não localizada.\n\n" +
        "**Administração:** conferir bula da apresentação exata.\n\n" +
        "**Receita:** não confirmado.\n\n**EAN:** não localizado.\n\n" +
        "**Segurança:** 🔴 necessita conferência.\n\n" +
        "Tente pesquisar pelo princípio ativo ou nome completo.\n\n" +
        "Fonte: [Dados Abertos da Anvisa](" + DATA_URL + ") • [Bulário Eletrônico](" + BULARIO_URL + ")"
      });
    }

    const table = [
      "| Campo | Informação |",
      "|---|---|",
      ...[
        ["Medicamento", matches.map(m => m.nome).join("; ")],
        ["Princípio ativo", matches.map(m => m.ativo).join("; ")],
        ["Registro MS / empresa", matches.map(m => m.registro + " — " + m.empresa).join("; ")],
        ["Indicação", "Não disponível na base cadastral; conferir bula"],
        ["Posologia", "Não localizada nesta base. Conferir bula da apresentação exata e faixa etária/peso."],
        ["Administração", "Conferir bula oficial da apresentação exata"],
        ["Receita", "Não confirmado nesta consulta"],
        ["EAN", "Não localizado nesta base"],
        ["Segurança", "🔴 Necessita conferência da bula, dose e apresentação"]
      ].map(([campo, info]) => "| **" + campo + "** | " + info + " |")
    ].join("\n");

    res.json({ answer:
      "**Consulta cadastral — resultado da Anvisa**\n\n" + table +
      "\n\n**Atenção:** esta consulta confirma apenas dados cadastrais. Não fornece posologia, EAN, tipo de receita ou estoque de distribuidores. Não usar como única base para dispensação.\n\n" +
      "Fonte: [Dados Abertos da Anvisa](" + DATA_URL + ") • [Bulário Eletrônico](" + BULARIO_URL + ")"
    });
  } catch (error) {
    console.error("Erro na consulta:", error);
    res.status(502).json({ error: "Não foi possível consultar a base da Anvisa agora. Tente novamente mais tarde." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(here, "public", "index.html")));
app.listen(port, () => console.log("Assistente de Balcão iniciado na porta " + port));