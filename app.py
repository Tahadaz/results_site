import io, json, zipfile, re
from dataclasses import dataclass
from typing import Dict, Optional, List

import pandas as pd
import streamlit as st

st.set_page_config(page_title="Backtest Results", layout="wide")

# ----------------------------
# Data model
# ----------------------------
@dataclass
class StockPack:
    ticker: str
    leaderboard: Optional[pd.DataFrame]
    profile: Dict
    notes: Dict
    plots_html: Dict[str, str]
    plots_png: Dict[str, bytes]
    plots_svg: Dict[str, bytes]

@dataclass
class SitePack:
    title: str
    about: Dict
    stocks: List[Dict]
    stockpacks: Dict[str, StockPack]
    raw_zip: bytes

# ----------------------------
# ZIP reader
# ----------------------------
def _safe_json(zf: zipfile.ZipFile, path: str, default):
    try:
        return json.loads(zf.open(path).read().decode("utf-8"))
    except Exception:
        return default

def _read_zip(upload_bytes: bytes) -> SitePack:
    zf = zipfile.ZipFile(io.BytesIO(upload_bytes), "r")
    names = zf.namelist()

    manifest = _safe_json(zf, "manifest.json", {})
    title = manifest.get("site_title", "Backtest Results")
    about = manifest.get("about", {})
    stocks = manifest.get("stocks", [])

    # If manifest missing stocks, infer tickers from folder structure
    if not stocks:
        tickers = set()
        for n in names:
            m = re.match(r"stocks/([^/]+)/", n)
            if m:
                tickers.add(m.group(1))
        stocks = [{"ticker": t, "name": t} for t in sorted(tickers)]

    stockpacks: Dict[str, StockPack] = {}

    for s in stocks:
        t = s.get("ticker")
        if not t:
            continue

        # leaderboard
        lb_path = f"stocks/{t}/leaderboard.csv"
        leaderboard = None
        if lb_path in names:
            leaderboard = pd.read_csv(zf.open(lb_path))

        # profile + notes
        profile = _safe_json(zf, f"stocks/{t}/profile.json", {"ticker": t, "name": s.get("name", t)})
        notes = _safe_json(zf, f"stocks/{t}/notes.json", {"global": "", "strategies": {}})

        # plots
        plots_html, plots_png, plots_svg = {}, {}, {}
        prefix = f"stocks/{t}/plots/"
        for n in names:
            if not n.startswith(prefix):
                continue
            base = n[len(prefix):]
            key = re.sub(r"\.(html|png|svg)$", "", base, flags=re.IGNORECASE)

            if n.lower().endswith(".html"):
                plots_html[key] = zf.open(n).read().decode("utf-8", errors="replace")
            elif n.lower().endswith(".png"):
                plots_png[key] = zf.open(n).read()
            elif n.lower().endswith(".svg"):
                plots_svg[key] = zf.open(n).read()

        stockpacks[t] = StockPack(
            ticker=t,
            leaderboard=leaderboard,
            profile=profile,
            notes=notes,
            plots_html=plots_html,
            plots_png=plots_png,
            plots_svg=plots_svg,
        )

    return SitePack(
        title=title,
        about=about,
        stocks=stocks,
        stockpacks=stockpacks,
        raw_zip=upload_bytes,
    )

def _strategy_guess_keys(strategy_name: str) -> List[str]:
    s = (strategy_name or "").strip()
    s0 = s.replace(" (best)", "").strip()
    return [s, s0, f"{s}_price_panel", f"{s0}_price_panel"]

# ----------------------------
# UI
# ----------------------------
st.sidebar.header("Load results")
up = st.sidebar.file_uploader("Upload results ZIP", type=["zip"])

if up is None:
    st.title("Backtest Results Site")
    st.info("Upload a results ZIP (with manifest.json + stocks/<TICKER>/... ).")
    st.stop()

pkg = _read_zip(up.getvalue())

st.title(pkg.title)

st.sidebar.download_button(
    "Download ZIP",
    data=pkg.raw_zip,
    file_name=up.name if up.name else "results.zip",
    mime="application/zip"
)

# Landing: list of companies first
st.subheader("Companies")
cols = st.columns(4)
tickers = [s["ticker"] for s in pkg.stocks if "ticker" in s]
ticker_to_name = {s["ticker"]: s.get("name", s["ticker"]) for s in pkg.stocks if "ticker" in s}

for i, t in enumerate(tickers):
    with cols[i % 4]:
        st.markdown(f"**{t}**")
        st.caption(ticker_to_name.get(t, t))

st.divider()

# About / what we are doing
st.subheader("What this is")
subtitle = pkg.about.get("subtitle", "")
if subtitle:
    st.markdown(subtitle)

bullets = pkg.about.get("bullets", [])
if bullets:
    for b in bullets:
        st.markdown(f"- {b}")

st.divider()

# Stock selector
st.subheader("Select a stock")
sel = st.selectbox("Ticker", options=tickers, index=0)
sp = pkg.stockpacks.get(sel)

if sp is None:
    st.error("No data found for this ticker in the ZIP.")
    st.stop()

# Stock presentation
p = sp.profile or {}
left, right = st.columns([1.2, 2.0])
with left:
    st.markdown(f"### {p.get('ticker', sel)}")
    st.markdown(f"**{p.get('name', ticker_to_name.get(sel, sel))}**")
    if p.get("sector"): st.caption(f"Sector: {p['sector']}")
    if p.get("exchange"): st.caption(f"Exchange: {p['exchange']}")
    if p.get("currency"): st.caption(f"Currency: {p['currency']}")
with right:
    if p.get("summary"):
        st.markdown("#### Quick overview")
        st.write(p["summary"])
    if p.get("key_points"):
        st.markdown("#### Key points")
        for k in p["key_points"]:
            st.markdown(f"- {k}")

st.divider()

# Leaderboard
st.subheader("Leaderboard (this stock)")
df = sp.leaderboard
if df is None or df.empty:
    st.warning("No leaderboard.csv found for this stock.")
else:
    # Sort/search controls
    c1, c2, c3 = st.columns([2.0, 1.2, 1.0])
    with c1:
        search = st.text_input("Search", value="")
    with c2:
        sort_col = st.selectbox("Sort by", options=list(df.columns), index=(list(df.columns).index("CAGR") if "CAGR" in df.columns else 0))
    with c3:
        asc = st.checkbox("Ascending", value=False)

    df_view = df.copy()
    if search.strip():
        mask = df_view.apply(lambda r: r.astype(str).str.contains(search, case=False, na=False).any(), axis=1)
        df_view = df_view[mask]

    df_view = df_view.sort_values(sort_col, ascending=asc, na_position="last").reset_index(drop=True)
    st.dataframe(df_view, use_container_width=True, height=420)

    # Strategy explanations + plot viewer
    st.subheader("Strategy plot + explanation")
    strat_col = "Strategy" if "Strategy" in df_view.columns else df_view.columns[0]
    pick = st.selectbox("Choose strategy", options=df_view[strat_col].astype(str).tolist(), index=0)

    notes = sp.notes or {}
    global_note = notes.get("global", "")
    strat_notes = (notes.get("strategies", {}) or {})

    if global_note:
        st.info(global_note)

    # Strategy key normalization for notes lookup
    pick_key = pick.replace(" (best)", "").strip()
    if pick_key in strat_notes:
        st.markdown("**Explanation**")
        st.write(strat_notes[pick_key])

    # Plot selection priority: HTML > SVG > PNG
    plot_html = plot_svg = plot_png = None
    candidates = _strategy_guess_keys(pick)

    for k in candidates:
        if k in sp.plots_html:
            plot_html = sp.plots_html[k]
            break
    if plot_html is None:
        for k, v in sp.plots_html.items():
            if pick_key in k:
                plot_html = v
                break

    if plot_html is None:
        for k in candidates:
            if k in sp.plots_svg:
                plot_svg = sp.plots_svg[k]
                break
    if plot_html is None and plot_svg is None:
        for k in candidates:
            if k in sp.plots_png:
                plot_png = sp.plots_png[k]
                break

    if plot_html is not None:
        st.components.v1.html(plot_html, height=820, scrolling=True)
    elif plot_svg is not None:
        st.image(plot_svg, use_container_width=True)
    elif plot_png is not None:
        st.image(plot_png, use_container_width=True)
    else:
        st.warning("No plot found for this strategy in the ZIP.")
