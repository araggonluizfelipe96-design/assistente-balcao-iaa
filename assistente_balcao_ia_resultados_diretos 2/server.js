import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(here, "public")));

const DATA_URL = "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv";
const BULARIO_URL = "https://www.gov.br/anvisa/pt-br/sistemas/bulario-eletronico";

const DISTRIBUTORS = [
  { name: "Santa Cruz", url: "https://stcruz.com.br/" },
  { name: "Panpharma", url: "https://www.panpharma.com.br/" },
  { name: "ProFarma", url: "https://www.profarma.com.br/" }
];

// Integração com catálogo autorizado. Configure URL e token no ambiente do servidor.
// O provedor deve responder: { results: [{ distributor, code, product }] }.
async function identifyWithGemini(query, matches = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "";
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [
        "Você é um assistente de identificação de medicamentos para farmácia no Brasil. " +
        "Sua única tarefa nesta etapa é identificar/corrigir o nome digitado e comparar com os resultados cadastrais fornecidos. " +
        "Não invente medicamentos, princípio ativo, dose, posologia, EAN, registro ou disponibilidade. " +
        "Se não houver correspondência confiável, diga que não foi possível identificar. " +
        "Responda em português, em no máximo 3 linhas.\n\n" +
        "Busca: " + query + "\nResultados oficiais encontrados: " + JSON.stringify(matches.slice(0, 8))
      ]
    });
    return String(response.text || "").trim().slice(0, 900);
  } catch (error) {
    console.error("Gemini indisponível:", error?.message || error);
    return "";
  }
}

async function searchDistributorCodes(query) {
  const endpoint = process.env.DISTRIBUTOR_CODES_API_URL;
  const token = process.env.DISTRIBUTOR_CODES_API_TOKEN;
  if (!endpoint || !token) return { connected: false, results: [] };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return { connected: true, results: [] };
    const data = await response.json();
    return {
      connected: true,
      results: (Array.isArray(data.results) ? data.results : [])
        .filter(x => x && x.distributor && x.code)
        .map(x => ({ distributor: String(x.distributor).slice(0, 80), code: String(x.code).slice(0, 80) }))
    };
  } catch {
    return { connected: true, results: [] };
  }
}

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
    const distributorLookup = await searchDistributorCodes(query);
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

    const aiIdentification = await identifyWithGemini(query, matches);

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
        ["Código — Santa Cruz", distributorLookup.connected ? (distributorLookup.results.filter(x => normalize(x.distributor) === "santa cruz").map(x => x.code).join("; ") || "Não localizado") : "Consulta não conectada"],
        ["Código — Panpharma", distributorLookup.connected ? (distributorLookup.results.filter(x => normalize(x.distributor).includes("panpharma")).map(x => x.code).join("; ") || "Não localizado") : "Consulta não conectada"],
        ["Código — ProFarma", distributorLookup.connected ? (distributorLookup.results.filter(x => normalize(x.distributor).includes("profarma")).map(x => x.code).join("; ") || "Não localizado") : "Consulta não conectada"],
        ["Outras distribuidoras", distributorLookup.connected ? (distributorLookup.results.filter(x => !["santa cruz", "panpharma", "profarma"].includes(normalize(x.distributor))).map(x => x.distributor + ": " + x.code).join("; ") || "Não localizado") : "Consulta ampliada não conectada"],
        ["Segurança", "🔴 Necessita conferência da bula, dose e apresentação"]
      ].map(([campo, info]) => "| **" + campo + "** | " + info + " |")
    ].join("\n");

    res.json({ answer:
      "**Consulta cadastral — resultado da Anvisa**\n\n" + (aiIdentification ? "**Gemini — identificação:** " + aiIdentification + "\n\n" : "") + table +
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