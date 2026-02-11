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
// Ticker helpers
// -----------------------------
function normalizeTicker(t) {
  return String(t ?? "").trim().toUpperCase();
}

function pickTicker(s) {
  // Accept common field names from manifest.json
  const t =
    s?.ticker ??
    s?.Ticker ??
    s?.symbol ??
    s?.Symbol ??
    s?.code ??
    s?.Code ??
    "";
  return String(t).trim();
}
const GLOSSARY_LINKS = {
  "cagr": "glossary.html#cagr",
  "total return": "glossary.html#total-return",
  "maxdd": "glossary.html#max-drawdown",
  "max drawdown": "glossary.html#max-drawdown",
  "drawdown": "glossary.html#max-drawdown",
  "sharpe": "glossary.html#sharpe",
  "signal": "glossary.html#signal",
};
function formatNumber2(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLedgerCellValue(v) {
  const n = tryNumber(v);
  if (n === null) return String(v ?? "");
  return formatNumber2(n);
}

function clearLedgerUI(message = "No ledger available for this strategy.") {
  const panel = $("#plotLedgerPanel");
  const meta = $("#plotLedgerMeta");
  const thead = $("#plotLedgerThead");
  const tbody = $("#plotLedgerTbody");

  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = `<tr><td class="muted">${message}</td></tr>`;
  if (meta) meta.textContent = "—";
  if (panel) panel.style.display = "none";
}

function renderLedgerTable(headers, rows) {
  const panel = $("#plotLedgerPanel");
  const thead = $("#plotLedgerThead");
  const tbody = $("#plotLedgerTbody");
  if (!thead || !tbody || !panel) return;

  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      const raw = r[h] ?? "";
      td.textContent = formatLedgerCellValue(raw);
      if (tryNumber(raw) !== null) td.classList.add("right");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  panel.style.display = "";
}

async function loadAndRenderLedgerForStrategy(strategyKey) {
  const panel = $("#plotLedgerPanel");
  const meta = $("#plotLedgerMeta");

  if (!strategyKey) {
    clearLedgerUI("Select a plot to view ledger.");
    return;
  }

  // example: assets/results/stocks/adi/ledgers/rsi_trade_ledger.csv
  const url = `assets/results/stocks/${ACTIVE_TICKER}/ledgers/${strategyKey}_trade_ledger.csv`;

  try {
    const csv = await fetchText(url);
    const { headers, rows } = parseCSV(csv);

    if (!headers.length) {
      clearLedgerUI("Ledger file is empty.");
      return;
    }

    if (meta) meta.textContent = `${strategyKey.toUpperCase()} • ${rows.length} rows`;
    renderLedgerTable(headers, rows);

    if (panel) panel.style.display = "";
  } catch (err) {
    // 404 = ledger doesn't exist for that strategy/stock
    if (String(err).includes(": 404")) {
      clearLedgerUI(`No ledger found for ${strategyKey.toUpperCase()} (missing file).`);
      return;
    }
    throw err; // other errors should surface
  }
}

// -----------------------------
// CSV parsing (robust: quoted commas + escaped quotes)
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
        if (row.some(x => x.trim() !== "")) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }

  // flush last row
  row.push(field);
  if (row.some(x => x.trim() !== "")) rows.push(row);

  const headers = (rows[0] ?? []).map(s => (s ?? "").trim());
  const dataRows = rows.slice(1);

  const outRows = dataRows.map(cols => {
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] ?? "").trim()));
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
let STOCKS = [];         // normalized manifest.stocks
let ACTIVE_TICKER = null;

let LB_HEADERS = [];
let LB_ROWS = [];
let LB_CSV_URL = null;

let PLOTS = [];
let ACTIVE_PLOT = null;

// -----------------------------
// Rendering: stock list (left)
// -----------------------------
function renderStockList(stocks) {
  const list = $("#stockList");
  list.innerHTML = "";

  stocks.forEach(s => {
    const item = el("div", "stockitem");

    // IMPORTANT: dataset.ticker must match the ticker used in loadStock() (folder key)
    item.dataset.ticker = s.ticker;

    const left = el("div", "stockitem__left");

    const t = el("div", "stockitem__ticker");
    t.textContent = s.ticker_display || s.ticker;

    const n = el("div", "stockitem__name");
    n.textContent = s.name || s.ticker_display || s.ticker;

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
      const a = String(s.ticker_display || s.ticker || "").toLowerCase();
      const b = String(s.name || "").toLowerCase();
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

// -----------------------------
// Best params parsing + formatting
// -----------------------------
function safeJSONParseBestParams(raw) {
  if (!raw) return null;

  let s = String(raw).trim();

  // If wrapped in extra quotes, remove them
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1);
  }

  // Handle CSV doubled quotes {""a"":1} -> {"a":1}
  if (s.includes('""')) s = s.replace(/""/g, '"');

  try {
    return JSON.parse(s);
  } catch (_) {
    try {
      const s2 = s
        .replace(/([{,]\s*)'([^']+?)'(\s*:)/g, '$1"$2"$3')
        .replace(/:\s*'([^']*?)'(\s*[},])/g, ':"$1"$2');
      return JSON.parse(s2);
    } catch {
      return null;
    }
  }
}

function pickParam(obj, path, fallback = null) {
  try {
    return path.split(".").reduce((acc, k) => acc?.[k], obj) ?? fallback;
  } catch { return fallback; }
}

function makeBestParamsSummary(parsed) {
  const window = pickParam(parsed, "strategy.window", "");
  const buy = pickParam(parsed, "portfolio.buy_pct_cash", "");
  const sell = pickParam(parsed, "portfolio.sell_pct_shares", "");
  const cd = pickParam(parsed, "portfolio.cooldown_bars", "");
  const minR = pickParam(parsed, "portfolio.min_return_before_sell", "");

  const bits = [];
  if (window !== "") bits.push(`window=${window}`);
  if (buy !== "") bits.push(`buy=${buy}`);
  if (sell !== "") bits.push(`sell=${sell}`);
  if (cd !== "") bits.push(`cd=${cd}`);
  if (minR !== "") bits.push(`minRet=${minR}`);
  return bits.join(" · ");
}

function prettyJSON(parsed) {
  return JSON.stringify(parsed, null, 2);
}

// -----------------------------
// Plot -> strategy mapping and "Best Params below plot"
// -----------------------------
function inferStrategyFromPlotFile(file) {
  const f = String(file ?? "").toLowerCase();
  if (f.includes("sma")) return "sma_price";
  if (f.includes("rsi")) return "rsi";
  if (f.includes("macd")) return "macd";
  if (f.includes("boll")) return "bollinger";
  if (f.includes("bbands")) return "bollinger";
  return f.split(/[_.-]/)[0] || "";
}

function findBestRowForStrategy(strategyKey) {
  if (!LB_ROWS?.length) return null;

  const candCols = ["strategy", "Strategy", "strat", "Strat", "signal", "Signal"];
  const stratCol = candCols.find(c => LB_HEADERS.includes(c));

  if (stratCol && strategyKey) {
    const matches = LB_ROWS.filter(r =>
      String(r[stratCol] ?? "").toLowerCase().includes(strategyKey)
    );
    if (matches.length) return matches[0]; // assumes LB_ROWS already sorted
  }

  return LB_ROWS[0];
}

function flattenKV(obj, prefix = "") {
  const out = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;

  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenKV(v, key));
    } else {
      out.push([key, v]);
    }
  }
  return out;
}

function renderParamsSections(parsed) {
  // parsed expected like { portfolio: {...}, strategy: {...} }
  const topKeys = Object.keys(parsed || {}).sort();
  if (!topKeys.length) return `<div class="muted">No params.</div>`;

  return topKeys.map(sectionName => {
    const section = parsed[sectionName];
    const pairs = (section && typeof section === "object" && !Array.isArray(section))
      ? flattenKV(section)
      : [[sectionName, section]];

    const rowsHtml = pairs.map(([k, v]) => `
      <tr>
        <td class="params-k">${escapeHtml(k)}</td>
        <td class="params-v">${escapeHtml(String(v))}</td>
      </tr>
    `).join("");

    return `
      <div class="params-section">
        <div class="params-title">${escapeHtml(sectionName)}</div>
        <table class="params-table">
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }).join("");
}

function renderPlotBestParams(plotFile) {
  const box = $("#plotBestParamsBox");
  const meta = $("#plotBestParamsMeta");
  if (!box || !meta) return;

  if (!plotFile) {
    meta.textContent = "—";
    box.textContent = "Select a plot to view params.";
    return;
  }

  const strategyKey = inferStrategyFromPlotFile(plotFile);
  const row = findBestRowForStrategy(strategyKey);

  if (!row) {
    meta.textContent = "—";
    box.textContent = "No leaderboard rows available.";
    return;
  }

  meta.textContent = strategyKey ? `Strategy: ${strategyKey.toUpperCase()}` : "Strategy: —";

  const raw = row["Best Params"] ?? row["best params"] ?? row["BEST PARAMS"] ?? "";
  const parsed = safeJSONParseBestParams(raw);

  if (!parsed) {
    box.textContent = String(raw ?? "");
    return;
  }

  box.innerHTML = renderParamsSections(parsed);
}


// -----------------------------
// Rendering: Leaderboard
// -----------------------------
function isPercentColumn(headerName) {
  const h = String(headerName || "").toLowerCase();
  return h.includes("cagr") || h.includes("total return") || h === "return" || h.includes("annual");
}

function formatNumber2(x) {
  // 2 decimals, but keep integers clean if you want: comment next line if not desired
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatCellValue(header, v) {
  const s = String(v ?? "").trim();
  if (s === "") return "";

  // if it's already percent in text
  if (s.includes("%")) {
    const n = tryNumber(s);
    if (n === null) return s;
    return `${formatNumber2(n)}%`;
  }

  const n = tryNumber(s);
  if (n === null) return s;

  // Percent columns: convert fraction -> percent
  if (isPercentColumn(header)) {
    // Heuristic: if value looks like 0.12 then it's 12%, if it looks like 12 then it's already percent
    const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
    return `${formatNumber2(pct)}%`;
  }

  return formatNumber2(n);
}

function renderLeaderboard(headers, rows) {
  const thead = $("#leaderboardThead");
  const tbody = $("#leaderboardTbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  // ✅ Remove Best Params column from display
  const displayHeaders = headers.filter(h => String(h).trim().toLowerCase() !== "best params");

  // header row
  const key = String(h).trim().toLowerCase();
  const href = GLOSSARY_LINKS[key];

  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = h;
    a.className = "glosslink";
    th.appendChild(a);
  } else {
    th.textContent = h;
  }


  // body
  rows.forEach(r => {
    const tr = document.createElement("tr");

    displayHeaders.forEach(h => {
      const td = document.createElement("td");
      const raw = r[h] ?? "";

      const formatted = formatCellValue(h, raw);
      td.textContent = formatted;

      // right align if numeric-ish OR percent column
      if (tryNumber(raw) !== null || isPercentColumn(h)) td.classList.add("right");

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

    if (an !== null && bn !== null) return bn - an;
    return String(av ?? "").localeCompare(String(bv ?? ""));
  });

  renderLeaderboard(LB_HEADERS, rows);
}

// -----------------------------
// Rendering: Plots
// -----------------------------
async function listPlotFiles(ticker) {
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

  sel.onchange = () => setActivePlot(sel.value);
}
function findHeaderCaseInsensitive(headers, wantLower) {
  const map = new Map(headers.map(h => [String(h).trim().toLowerCase(), h]));
  return map.get(wantLower) || null;
}

function computeAggregateSignal(headers, rows) {
  // find "signal" column case-insensitively
  const sigH =
    findHeaderCaseInsensitive(headers, "signal") ||
    findHeaderCaseInsensitive(headers, "signals") ||
    findHeaderCaseInsensitive(headers, "sig");

  if (!sigH) return { sum: 0, label: "HOLD" };

  let sum = 0;
  for (const r of rows) {
    const raw = r?.[sigH];
    const n = Number(String(raw ?? "").trim());
    if (Number.isFinite(n)) sum += n;
  }

  const label = sum > 0 ? "BUY" : sum < 0 ? "SELL" : "HOLD";
  return { sum, label };
}

function renderAggregateSignalUI({ sum, label }) {
  const node = $("#stockAggSignal");
  if (!node) return;

  node.style.display = ""; // show pill
  node.textContent = label;

  node.classList.remove("signal--buy", "signal--sell", "signal--hold");
  if (label === "BUY") node.classList.add("signal--buy");
  else if (label === "SELL") node.classList.add("signal--sell");
  else node.classList.add("signal--hold");

  // optional tooltip
  node.title = `Sum(signal) = ${sum}`;
}

function setActivePlot(file) {
  ACTIVE_PLOT = file || null;
  const frame = $("#plotFrame");
  const href = $("#openPlotNewTab");

  if (!ACTIVE_PLOT) {
    frame.removeAttribute("src");
    href.setAttribute("href", "#");
    renderPlotBestParams(null);
    clearLedgerUI("Select a plot to view ledger.");
    return;
  }

  const src = `assets/results/stocks/${ACTIVE_TICKER}/plots/${ACTIVE_PLOT}`;
  frame.src = src;
  href.href = src;

  renderPlotBestParams(ACTIVE_PLOT);

  // NEW: ledger under the plot
  const strategyKey = inferStrategyFromPlotFile(ACTIVE_PLOT);
  loadAndRenderLedgerForStrategy(strategyKey).catch(showError);
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
// Load one stock
// -----------------------------
async function loadStock(ticker) {
  if (!ticker) {
    throw new Error(
      "loadStock() called with empty ticker. Check manifest.json stocks entries (expected ticker/symbol/code)."
    );
  }

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
  // NEW: compute + render aggregated signal for this stock
  const agg = computeAggregateSignal(LB_HEADERS, LB_ROWS);
  renderAggregateSignalUI(agg);

  // sort metric
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

  // Normalize stocks once, keep:
  // - ticker: used for folder paths (must match your /assets/results/stocks/{ticker}/)
  // - ticker_display: shown in UI (UPPERCASE, professional)
  STOCKS = (SITE.stocks || [])
    .map(s => {
      const ticker = pickTicker(s);
      return {
        ...s,
        ticker,
        ticker_display: normalizeTicker(ticker),
      };
    })
    .filter(s => s.ticker);

  renderAbout(SITE);
  renderStockList(STOCKS);
  setupSearch();

  $("#rankBy").onchange = () => {
    const metric = $("#rankBy").value;
    sortLeaderboardBy(metric);
  };

  $("#refreshBtn").onclick = (e) => {
    e.preventDefault();
    init().catch(showError);
  };

  if (SITE.repo_url) {
    const b = $("#openRepoBtn");
    b.href = SITE.repo_url;
    b.style.display = "";
  }

  if (STOCKS.length > 0) {
    await loadStock(STOCKS[0].ticker);
  } else {
    showContentPanels(false);
  }

  setLoadingState(false);
}

init().catch(showError);
