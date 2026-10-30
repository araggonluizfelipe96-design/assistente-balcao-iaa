import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(here, "public")));

const DATA_URL =
  "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv";

let catalog = null;
let lastUpdate = 0;
let loading = null;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ";" && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += ch;
    }
  }

  cells.push(value.trim());
  return cells;
}

async function loadCatalog() {
  if (catalog && Date.now() - lastUpdate < 6 * 60 * 60 * 1000) {
    return catalog;
  }

  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(DATA_URL, {
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      throw new Error("Base da Anvisa indisponível.");
    }

    const buffer = await response.arrayBuffer();

    const csv = new TextDecoder("windows-1252")
      .decode(buffer)
      .replace(/^\uFEFF/, "");

    const lines = csv.split(/\r?\n/).filter(Boolean);

    if (lines.length < 2) {
      throw new Error("Base vazia.");
    }

    const headers = parseCsvLine(lines[0]).map(header =>
      normalize(header).replace(/ /g, "_")
    );

    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);

      if (!cells.some(Boolean)) continue;

      const row = {};

      headers.forEach((key, index) => {
        row[key] = cells[index] || "";
      });

      rows.push(row);
    }

    catalog = rows;
    lastUpdate = Date.now();

    return catalog;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    fonte: "Anvisa - Dados Abertos",
    catalogoCarregado: Boolean(catalog)
  });
});

app.post("/api/search", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  const age = String(req.body?.age || "").trim();
  const weight = String(req.body?.weight || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Digite o nome do medicamento."
    });
  }

  if (query.length > 180) {
    return res.status(400).json({
      error: "Busca muito longa."
    });
  }

  if (weight && (!Number.isFinite(Number(weight)) ||
      Number(weight) <= 0 || Number(weight) > 300)) {
    return res.status(400).json({
      error: "Informe um peso válido em kg."
    });
  }

  try {
    const rows = await loadCatalog();
    const needle = normalize(query);
    const terms = needle.split(" ").filter(term => term.length > 1);

    const matches = [];

    for (const row of rows) {
      const name = row.nome_produto || "";
      const active = row.principio_ativo || "";
      const searchable = normalize(name + " " + active);

      if (
        !searchable.includes(needle) &&
        !terms.every(term => searchable.includes(term))
      ) {
        continue;
      }

      matches.push({
        nome: name || "Não informado",
        ativo: active || "Não informado",
        registro: row.numero_registro_produto || "Não informado",
        empresa:
          row.empresa_detentora_registro ||
          row.razao_social ||
          "Não informado"
      });

      if (matches.length >= 30) break;
    }

    const patientInfo = [];

    if (age) patientInfo.push("Faixa etária: " + age);
    if (weight) patientInfo.push("Peso: " + weight + " kg");

    const patientText = patientInfo.length
      ? "\n\n**Paciente:** " + patientInfo.join(" • ")
      : "";

    if (!matches.length) {
      return res.json({
        answer:
          "**Nenhum medicamento correspondente foi localizado na base da Anvisa.**\n\n" +
          "Tente pesquisar pelo princípio ativo ou pelo nome completo." +
          patientText +
          "\n\nFonte: [Dados Abertos da Anvisa](" +
          DATA_URL +
          ")"
      });
    }

    const table = [
      "| Medicamento | Princípio ativo | Registro MS | Empresa |",
      "|---|---|---|---|",
      ...matches.map(item =>
        `| ${item.nome} | ${item.ativo} | ${item.registro} | ${item.empresa} |`
      )
    ].join("\n");

    const doseNotice =
      "**Posologia:** não calculada. A base consultada não fornece dose, concentração ou intervalo de administração. É necessário conferir a bula da apresentação exata antes de orientar o uso.";

    res.json({
      answer:
        "**Resultados da base oficial da Anvisa**\n\n" +
        table +
        patientText +
        "\n\n" +
        doseNotice +
        "\n\n**EAN:** não disponível nesta base.\n\n" +
        "**Estoque em distribuidores:** não consultado.\n\n" +
        "Fonte: [Dados Abertos da Anvisa](" +
        DATA_URL +
        ")\n" +
        "Bulas oficiais: [Bulário Eletrônico da Anvisa](https://www.gov.br/anvisa/pt-br/sistemas/bulario-eletronico)"
    });
  } catch (error) {
    console.error("Erro na consulta:", error);

    res.status(502).json({
      error:
        "Não foi possível consultar a base da Anvisa agora. Tente novamente mais tarde."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(here, "public", "index.html"));
});

app.listen(port, () => {
  console.log("Assistente de Balcão iniciado na porta " + port);
});
