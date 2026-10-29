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
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

// Renderiza Markdown simples com escape de HTML; links só abrem em nova aba.
function renderMarkdown(md) {
  let html = escapeHtml(md);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  const lines = html.split(/\r?\n/);
  let out = "", inTable = false, tableRows = [];
  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.filter(row => !/^\s*\|?[\s:|-]+\|?\s*$/.test(row));
    if (rows.length) {
      out += "<table>";
      rows.forEach((row, i) => {
        const cells = row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        out += "<tr>" + cells.map(c => i === 0
          ? `<th>${c}</th>` : `<td>${c}</td>`).join("") + "</tr>";
      });
      out += "</table>";
    }
    tableRows = []; inTable = false;
  };
  for (const line of lines) {
    if (line.includes("|") && line.trim().startsWith("|")) {
      inTable = true; tableRows.push(line); continue;
    }
    flushTable();
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) out += `<h3>${h[2]}</h3>`;
    else if (/^\s*[-*]\s+/.test(line)) out += `<p>• ${line.replace(/^\s*[-*]\s+/, "")}</p>`;
    else if (/^\s*\d+\.\s+/.test(line)) out += `<p>${line}</p>`;
    else if (line.trim()) out += `<p>${line}</p>`;
  }
  flushTable();
  return out;
}

async function search(query) {
  resultCard.hidden = true;
  errorCard.hidden = true;
  button.disabled = true;
  button.innerHTML = "Pesquisando…";
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível pesquisar.");
    lastPlainText = data.answer || "";
    result.innerHTML = renderMarkdown(lastPlainText);
    document.querySelector("#result-title").textContent = `Busca: ${query}`;
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    errorCard.textContent = error.message || "Erro ao pesquisar.";
    errorCard.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Buscar EANs <span aria-hidden="true">→</span>';
  }
}
form.addEventListener("submit", event => {
  event.preventDefault();
  const query = input.value.trim();
  if (query) search(query);
});
document.querySelectorAll("[data-query]").forEach(el => {
  el.addEventListener("click", () => {
    input.value = el.dataset.query;
    search(input.value);
  });
});
copyButton.addEventListener("click", async () => {
  if (!lastPlainText) return;
  try {
    await navigator.clipboard.writeText(lastPlainText);
    copyButton.textContent = "Copiado!";
    setTimeout(() => copyButton.textContent = "Copiar resultado", 1500);
  } catch {
    copyButton.textContent = "Selecione e copie";
  }
});