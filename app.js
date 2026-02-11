// app.js

// -----------------------------
// Fetch helpers
// -----------------------------
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return await r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return await r.text();
}

// -----------------------------
// CSV parsing (robust, supports quoted commas + escaped quotes)
// -----------------------------
function parseCSV(csvText) {
  const text = (csvText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return { headers: [], rows: [] };

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // escaped quote "" -> "
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        // ignore empty trailing lines
        if (row.some(x => x.trim() !== "")) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }

  // flush last field/row
  row.push(field);
  if (row.some(x => x.trim() !== "")) rows.push(row);

  const headers = (rows[0] ?? []).map(s => (s ?? "").trim());
  const dataRows = rows.slice(1);

  const outRows = dataRows.map(cols => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    return obj;
  });

  return { headers, rows: outRows };
}


// -----------------------------
// DOM helpers
// -----------------------------
function $(sel) { return document.querySelector(sel); }
function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function setVisible(selector, on) {
  const node = $(selector);
  if (!node) return;
  node.style.display = on ? "" : "none";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatGeneratedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function tryNumber(x) {
  const v = Number(String(x).replaceAll("%", "").replaceAll(" ", "").replaceAll(",", "."));
  return Number.isFinite(v) ? v : null;
}

// -----------------------------
// Global state
// -----------------------------
let SITE = null;         // manifest.json
let STOCKS = [];         // manifest.stocks
let ACTIVE_TICKER = null;

let LB_HEADERS = [];
let LB_ROWS = [];
let LB_CSV_URL = null;

let PLOTS = [];          // plots.json plots
let ACTIVE_PLOT = null;

// -----------------------------
// Rendering: stock list (left)
// -----------------------------
function renderStockList(stocks) {
  const list = $("#stockList");
  list.innerHTML = "";

  stocks.forEach(s => {
    const item = el("div", "stockitem");
    item.dataset.ticker = s.ticker;

    const left = el("div", "stockitem__left");
    const t = el("div", "stockitem__ticker");
    t.textContent = s.ticker;

    const n = el("div", "stockitem__name");
    n.textContent = s.name || s.ticker;

    left.appendChild(t);
    left.appendChild(n);

    const chev = el("div", "stockitem__chev");
    chev.textContent = "›";

    item.appendChild(left);
    item.appendChild(chev);

    item.addEventListener("click", () => {
      loadStock(s.ticker).catch(showError);
    });

    list.appendChild(item);
  });

  // apply active highlight
  updateActiveStockInList();
}

function updateActiveStockInList() {
  document.querySelectorAll(".stockitem").forEach(node => {
    const isActive = node.dataset.ticker === ACTIVE_TICKER;
    node.classList.toggle("stockitem--active", isActive);
  });
}

function setupSearch() {
  const input = $("#stockSearch");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const filtered = STOCKS.filter(s => {
      const a = (s.ticker || "").toLowerCase();
      const b = (s.name || "").toLowerCase();
      return a.includes(q) || b.includes(q);
    });
    renderStockList(filtered);
  });
}

// -----------------------------
// Rendering: About section
// -----------------------------
function renderAbout(site) {
  $("#siteTitle").textContent = site.site_title || "Results";
  $("#siteSubtitle").textContent = site.about?.subtitle || "";

  const bullets = $("#aboutBullets");
  bullets.innerHTML = "";
  (site.about?.bullets || []).forEach(b => {
    const li = document.createElement("li");
    li.textContent = b;
    bullets.appendChild(li);
  });

  $("#generatedAt").textContent = `Generated: ${formatGeneratedAt(site.generated_at)}`;
}

// -----------------------------
// Rendering: Profile
// -----------------------------
function renderProfile(profile) {
  $("#stockTicker").textContent = profile.ticker || ACTIVE_TICKER || "—";
  $("#stockName").textContent = profile.name || profile.ticker || "—";

  // Optional meta line: exchange / currency / period / anything you store
  const metaBits = [];
  if (profile.exchange) metaBits.push(profile.exchange);
  if (profile.currency) metaBits.push(profile.currency);
  if (profile.period) metaBits.push(profile.period);
  $("#stockMeta").textContent = metaBits.length ? metaBits.join(" • ") : "—";

  const sector = profile.sector || "";
  if (sector) {
    $("#stockSector").textContent = sector;
    setVisible("#stockSector", true);
  } else {
    setVisible("#stockSector", false);
  }

  $("#stockSummary").textContent = profile.summary || "";

  // Optional notes array -> bullet list
  const notes = profile.notes;
  if (Array.isArray(notes) && notes.length) {
    const box = $("#stockNotes");
    box.innerHTML = `
      <div class="notes__title">Notes</div>
      <ul>${notes.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    `;
    setVisible("#stockNotes", true);
  } else {
    setVisible("#stockNotes", false);
  }
}
function safeJSONParseBestParams(raw) {
  if (!raw) return null;

  let s = String(raw).trim();

  // If cell is wrapped in extra quotes, remove them
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1);
  }

  // Handle the CSV-style doubled quotes {""a"":1} -> {"a":1}
  if (s.includes('""')) s = s.replace(/""/g, '"');

  // Sometimes people export with single quotes (rare but possible)
  // We do NOT blindly replace all single quotes (can corrupt data),
  // but if JSON.parse fails, we attempt a conservative fallback.
  try {
    return JSON.parse(s);
  } catch (_) {
    try {
      const s2 = s.replace(/([{,]\s*)'([^']+?)'(\s*:)/g, '$1"$2"$3')  // keys
                  .replace(/:\s*'([^']*?)'(\s*[},])/g, ':"$1"$2');   // string values
      return JSON.parse(s2);
    } catch (e2) {
      return null;
    }
  }
}

function flattenParams(obj, prefix = "") {
  const out = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      const v = obj[k];
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        out.push(...flattenParams(v, p));
      } else {
        out.push([p, v]);
      }
    }
  }
  return out;
}

function formatBestParams(raw) {
  const parsed = safeJSONParseBestParams(raw);
  if (!parsed) return String(raw ?? "");

  // Group by top-level (portfolio, strategy, etc.) for readability
  const topKeys = Object.keys(parsed).sort();
  const lines = [];

  for (const top of topKeys) {
    const v = parsed[top];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      lines.push(`${top}:`);
      const pairs = flattenParams(v, "");
      for (const [k, val] of pairs) {
        lines.push(`  ${k} = ${val}`);
      }
    } else {
      lines.push(`${top} = ${v}`);
    }
  }

  return lines.join("\n");
}

// -----------------------------
// Rendering: Leaderboard
// Uses #leaderboardThead and #leaderboardTbody from index.html
// -----------------------------
function renderLeaderboard(headers, rows) {
  const thead = $("#leaderboardThead");
  const tbody = $("#leaderboardTbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  // header row
  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  // body rows
  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      const v = r[h] ?? "";
      if (h.toLowerCase() === "best params") {
        td.classList.add("mono", "wrap");
        td.textContent = formatBestParams(v);
      } else {
        td.textContent = v;
      }

      // right align numeric-ish
      if (tryNumber(v) !== null) td.classList.add("right");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  $("#leaderboardHint").textContent = rows.length
    ? `Showing ${rows.length} rows.`
    : "No rows found in leaderboard.csv.";
}

function sortLeaderboardBy(metric) {
  if (!LB_ROWS || !LB_ROWS.length) return;

  const rows = [...LB_ROWS];
  rows.sort((a, b) => {
    const av = a[metric];
    const bv = b[metric];
    const an = tryNumber(av);
    const bn = tryNumber(bv);

    // numeric desc if possible
    if (an !== null && bn !== null) return bn - an;

    // otherwise string asc
    return String(av ?? "").localeCompare(String(bv ?? ""));
  });

  renderLeaderboard(LB_HEADERS, rows);
}

// -----------------------------
// Rendering: Plots (single iframe + select)
// -----------------------------
async function listPlotFiles(ticker) {
  // expects: { "plots": ["plot1.html", ...] } OR { "plots": [{ "file": "...", "label": "..."}, ...] }
  const url = `assets/results/stocks/${ticker}/plots/plots.json`;
  return await fetchJSON(url);
}

function normalizePlots(plotsManifest) {
  const p = plotsManifest?.plots || [];
  return p.map(x => {
    if (typeof x === "string") {
      return { file: x, label: x.replaceAll("_", " ").replace(".html", "") };
    }
    if (x && typeof x === "object") {
      return {
        file: x.file || x.path || "",
        label: x.label || x.title || (x.file || "").replaceAll("_", " ").replace(".html", "")
      };
    }
    return { file: "", label: "Plot" };
  }).filter(x => x.file);
}

function renderPlotPicker(plots) {
  const sel = $("#plotPicker");
  sel.innerHTML = "";

  plots.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.file;
    opt.textContent = p.label || p.file;
    sel.appendChild(opt);
  });

  sel.addEventListener("change", () => {
    setActivePlot(sel.value);
  });
}

function setActivePlot(file) {
  ACTIVE_PLOT = file || null;
  const frame = $("#plotFrame");
  const href = $("#openPlotNewTab");

  if (!ACTIVE_PLOT) {
    frame.removeAttribute("src");
    href.setAttribute("href", "#");
    return;
  }

  const src = `assets/results/stocks/${ACTIVE_TICKER}/plots/${ACTIVE_PLOT}`;
  frame.src = src;

  href.href = src;
}

function bindDownloadLeaderboard() {
  const btn = $("#downloadLeaderboardBtn");
  btn.onclick = () => {
    if (!LB_CSV_URL) return;
    const a = document.createElement("a");
    a.href = LB_CSV_URL;
    a.download = `${ACTIVE_TICKER || "leaderboard"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
}

// -----------------------------
// Error handling + UI states
// -----------------------------
function clearError() {
  setVisible("#errorPanel", false);
  $("#errorDetails").textContent = "";
}

function showError(err) {
  console.error(err);
  setVisible("#errorPanel", true);
  $("#errorDetails").textContent = String(err?.stack || err);
}

function setLoadingState(isLoading) {
  // minimal: disable refresh button while loading
  const r = $("#refreshBtn");
  if (r) r.style.pointerEvents = isLoading ? "none" : "auto";
  if (r) r.style.opacity = isLoading ? "0.6" : "1";
}

function showContentPanels(hasStock) {
  setVisible("#aboutPanel", true);

  setVisible("#stockPanel", hasStock);
  setVisible("#leaderboardPanel", hasStock);
  setVisible("#plotsPanel", hasStock);

  setVisible("#emptyState", !hasStock);
}

// -----------------------------
// Load one stock (profile + leaderboard + plots)
// -----------------------------
async function loadStock(ticker) {
  clearError();
  setLoadingState(true);

  ACTIVE_TICKER = ticker;
  updateActiveStockInList();

  showContentPanels(true);

  // profile.json
  const profileUrl = `assets/results/stocks/${ticker}/profile.json`;
  const profile = await fetchJSON(profileUrl);
  renderProfile(profile);

  // leaderboard.csv
  LB_CSV_URL = `assets/results/stocks/${ticker}/leaderboard.csv`;
  const csv = await fetchText(LB_CSV_URL);
  const { headers, rows } = parseCSV(csv);
  LB_HEADERS = headers;
  LB_ROWS = rows;

  // default sort metric: whatever current dropdown says
  const metric = $("#rankBy").value || "CAGR";
  sortLeaderboardBy(metric);

  // plots
  const plotsManifest = await listPlotFiles(ticker);
  PLOTS = normalizePlots(plotsManifest);
  renderPlotPicker(PLOTS);
  if (PLOTS.length) {
    $("#plotPicker").value = PLOTS[0].file;
    setActivePlot(PLOTS[0].file);
  } else {
    setActivePlot(null);
  }

  // leaderboard download button
  bindDownloadLeaderboard();

  setLoadingState(false);
}

// -----------------------------
// Init site
// -----------------------------
async function init() {
  clearError();
  setLoadingState(true);

  SITE = await fetchJSON("assets/results/manifest.json");
  STOCKS = SITE.stocks || [];

  renderAbout(SITE);
  renderStockList(STOCKS);
  setupSearch();

  // rank dropdown
  $("#rankBy").addEventListener("change", () => {
    const metric = $("#rankBy").value;
    sortLeaderboardBy(metric);
  });

  // refresh button
  $("#refreshBtn").addEventListener("click", (e) => {
    e.preventDefault();
    init().catch(showError);
  });

  // Optional repo button if you add SITE.repo_url
  if (SITE.repo_url) {
    const b = $("#openRepoBtn");
    b.href = SITE.repo_url;
    b.style.display = "";
  }

  // If at least one stock, auto-load first
  if (STOCKS.length > 0) {
    await loadStock(STOCKS[0].ticker);
  } else {
    showContentPanels(false);
  }

  setLoadingState(false);
}

init().catch(showError);
