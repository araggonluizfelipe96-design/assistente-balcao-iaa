const form = document.querySelector("#search-form");
const input = document.querySelector("#query");
const button = document.querySelector("#search-button");
const resultCard = document.querySelector("#result-card");
const result = document.querySelector("#result");
const errorCard = document.querySelector("#error-card");
const copyButton = document.querySelector("#copy-button");
let lastPlainText = "";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function renderMarkdown(md) {
  let html = escapeHtml(md);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  const lines = html.split(/\r?\n/);
  let out = "";
  let tableRows = [];
  function flushTable() {
    if (!tableRows.length) return;
    const rows = tableRows.filter(row => !/^\s*\|?[\s:|-]+\|?\s*$/.test(row));
    if (rows.length) {
      out += "<table>";
      rows.forEach((row, index) => {
        const cells = row.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        out += "<tr>" + cells.map(cell => index === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`).join("") + "</tr>";
      });
      out += "</table>";
    }
    tableRows = [];
  }
  for (const line of lines) {
    if (line.includes("|") && line.trim().startsWith("|")) {
      tableRows.push(line);
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) out += `<h3>${heading[2]}</h3>`;
    else if (/^\s*[-*]\s+/.test(line)) out += `<p>• ${line.replace(/^\s*[-*]\s+/, "")}</p>`;
    else if (line.trim()) out += `<p>${line}</p>`;
  }
  flushTable();
  return out;
}

async function search(query) {
  resultCard.hidden = true;
  errorCard.hidden = true;
  button.disabled = true;
  button.textContent = "Pesquisando...";
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível pesquisar.");
    lastPlainText = data.answer || "Nenhum resultado encontrado.";
    result.innerHTML = renderMarkdown(lastPlainText);
    document.querySelector("#result-title").textContent = "Busca: " + query;
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    errorCard.textContent = error.message || "Erro ao pesquisar. Tente novamente.";
    errorCard.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const query = input.value.trim();
  if (query) search(query);
});

document.querySelectorAll("[data-query]").forEach(element => {
  element.addEventListener("click", () => {
    input.value = element.dataset.query;
    search(input.value);
  });
});

copyButton.addEventListener("click", async () => {
  if (!lastPlainText) return;
  try {
    await navigator.clipboard.writeText(lastPlainText);
    copyButton.textContent = "Copiado!";
    setTimeout(() => { copyButton.textContent = "Copiar resultado"; }, 1500);
  } catch {
    copyButton.textContent = "Selecione e copie";
  }
});