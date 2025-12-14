/* Nof1-style static dashboard (simulated data).
   Replace dataAdapter with your backend (REST/SSE/WebSocket). */

(() => {
  const START_CAPITAL = 10000;
  const UPDATE_MS = 2000;

  // ------------------------------------------------------------
  // Models (metadata)
  // ------------------------------------------------------------
  const MODELS = [
    { id: "deepseek", name: "DeepSeek V3.1", style: "Aggressive scalping", color: "#e9eaf1" },
    { id: "grok",     name: "Grok-4",        style: "Trend-following",     color: "#a7adbf" },
    { id: "claude",   name: "Claude Sonnet", style: "Cautious",           color: "#7f879e" },
    { id: "qwen",     name: "Qwen3",         style: "Event-driven",        color: "#c8cbe0" },
    { id: "gpt",      name: "GPT",           style: "Discretionary macro", color: "#b9bfd6" },
    { id: "gemini",   name: "Gemini",        style: "High turnover",       color: "#d6daee" },
  ];

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  let paused = false;
  let range = "6h"; // default
  let selectedModel = MODELS[0].id;

  const now = () => new Date();
  const fmtMoney = (v) => v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtPct = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  function makeSeededRng(seed) {
    // Mulberry32
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = makeSeededRng(20251214);

  // per-model series data
  const series = {};
  MODELS.forEach((m, i) => {
    series[m.id] = {
      values: [],
      // risk metrics (simulated)
      dd: 0.0, turnover: 0.0, exposure: 0.0,
      // positions
      positions: [],
      // feed
      feed: []
    };
    // initial points
    for (let k = 0; k < 120; k++) {
      series[m.id].values.push(START_CAPITAL * (1 + (i - 2) * 0.002) + (rng() - 0.5) * 80);
    }
  });

  // ------------------------------------------------------------
  // Data adapter (replaceable)
  // ------------------------------------------------------------
  const dataAdapter = {
    async fetchSnapshot() {
      // In real use: fetch('/api/snapshot') or pull from WebSocket buffer.
      // Here: evolve values with a random walk + idiosyncratic drift.
      const ts = now();
      MODELS.forEach((m, idx) => {
        const s = series[m.id];
        const last = s.values[s.values.length - 1];

        // Drift is mildly different to create separation.
        const drift = (idx - 2.5) * 0.35;  // USD per tick
        const vol = 60 + idx * 5;          // USD per tick
        const shock = (rng() - 0.5) * vol;

        const next = Math.max(2000, last + drift + shock);
        s.values.push(next);

        // Keep max history
        const maxN = historySize(range);
        if (s.values.length > maxN) s.values.splice(0, s.values.length - maxN);

        // Risk metrics
        const peak = Math.max(...s.values);
        const dd = (peak - next) / peak;
        s.dd = clamp(dd, 0, 0.60);
        s.turnover = clamp((0.12 + rng() * 0.88) * (idx % 2 ? 1.0 : 0.7), 0, 1);
        s.exposure = clamp((0.10 + rng() * 0.90) * (idx === 1 ? 1.0 : 0.85), 0, 1);

        // Occasionally add a feed line
        if (rng() < 0.45) {
          pushFeed(m.id, synthDecision(m.id, next));
        }

        // Update positions
        s.positions = synthPositions(m.id, next);
      });

      return { ts, models: MODELS.map(m => ({ id: m.id, name: m.name })) };
    }
  };

  function historySize(r) {
    // 1h: 30 points, 6h: 180 points, 24h: 720 points (2s cadence approximated)
    if (r === "1h") return 90;
    if (r === "24h") return 720;
    return 270;
  }

  // ------------------------------------------------------------
  // UI elements
  // ------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);

  $("#year").textContent = new Date().getFullYear();

  const tsLabel = $("#tsLabel");
  const lastTick = $("#lastTick");
  const liveChip = $("#liveStatusChip");
  const pauseBtn = $("#pauseBtn");
  const themeBtn = $("#themeBtn");

  const modelSel = $("#modelSel");
  MODELS.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    modelSel.appendChild(opt);
  });
  modelSel.value = selectedModel;

  modelSel.addEventListener("change", () => {
    selectedModel = modelSel.value;
    renderFeed();
    renderPositions();
  });

  $("#newNoteBtn").addEventListener("click", () => {
    const note = prompt("Add a short note (stored locally):");
    if (!note) return;
    pushFeed(selectedModel, { kind: "note", text: note, ts: now() });
    renderFeed();
  });

  document.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      range = btn.dataset.range;
    });
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    liveChip.textContent = paused ? "PAUSED" : "LIVE";
    liveChip.className = paused ? "chip" : "chip live";
  });

  themeBtn.addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme") || "dark";
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });

  // ------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------
  function labelsFromLen(n) {
    // lightweight time labels
    const out = [];
    const t = now();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(t.getTime() - i * UPDATE_MS);
      out.push(d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
    return out;
  }

  const mainCtx = $("#mainChart").getContext("2d");
  const heroCtx = $("#heroSpark").getContext("2d");

  const mainChart = new Chart(mainCtx, {
    type: "line",
    data: {
      labels: labelsFromLen(series[MODELS[0].id].values.length),
      datasets: MODELS.map(m => ({
        label: m.name,
        data: series[m.id].values.slice(),
        borderColor: m.color,
        backgroundColor: m.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: getCss("--muted") } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { color: getCss("--muted2"), maxTicksLimit: 6 }, grid: { color: getCss("--line") } },
        y: { ticks: { color: getCss("--muted2"), callback: (v) => fmtMoney(v) }, grid: { color: getCss("--line") } }
      }
    }
  });

  const heroChart = new Chart(heroCtx, {
    type: "line",
    data: {
      labels: labelsFromLen(40),
      datasets: MODELS.slice(0, 3).map(m => ({
        label: m.name,
        data: series[m.id].values.slice(-40),
        borderColor: m.color,
        backgroundColor: m.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function refreshChartColors() {
    mainChart.options.plugins.legend.labels.color = getCss("--muted");
    mainChart.options.scales.x.ticks.color = getCss("--muted2");
    mainChart.options.scales.y.ticks.color = getCss("--muted2");
    mainChart.options.scales.x.grid.color = getCss("--line");
    mainChart.options.scales.y.grid.color = getCss("--line");
    mainChart.update("none");
  }

  // when theme changes
  const themeObserver = new MutationObserver(refreshChartColors);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ------------------------------------------------------------
  // Leaderboard
  // ------------------------------------------------------------
  const lbBody = $("#lbBody");
  const sortSel = $("#sortSel");
  const filterInp = $("#filterInp");

  sortSel.addEventListener("change", renderLeaderboard);
  filterInp.addEventListener("input", renderLeaderboard);

  function currentValue(id) {
    const v = series[id].values;
    return v[v.length - 1];
  }

  function pnlPct(id) {
    return (currentValue(id) - START_CAPITAL) / START_CAPITAL;
  }

  function renderLeaderboard() {
    const q = filterInp.value.trim().toLowerCase();
    const rows = MODELS
      .filter(m => m.name.toLowerCase().includes(q) || m.id.includes(q))
      .map(m => {
        const s = series[m.id];
        return {
          id: m.id,
          name: m.name,
          style: m.style,
          value: currentValue(m.id),
          pnl: pnlPct(m.id),
          dd: s.dd,
          turnover: s.turnover,
          status: s.dd > 0.25 ? "Risk" : (s.turnover > 0.8 ? "Hot" : "OK")
        };
      });

    const key = sortSel.value;
    rows.sort((a, b) => {
      if (key === "value") return b.value - a.value;
      if (key === "pnl") return b.pnl - a.pnl;
      if (key === "dd") return a.dd - b.dd; // lower is better
      return a.turnover - b.turnover;       // lower is better
    });

    lbBody.innerHTML = "";
    rows.forEach(r => {
      const tr = document.createElement("tr");

      const pnlClass = r.pnl >= 0 ? "good" : "bad";
      const statusBadge = statusToBadge(r.status);

      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="swatch" aria-hidden="true" style="width:10px;height:10px;border-radius:999px;background:${colorFor(r.id)}"></span>
            <div>
              <div style="font-weight:700">${escapeHtml(r.name)}</div>
              <div class="muted" style="font-family: var(--mono); font-size: 10px;">${escapeHtml(r.id)}</div>
            </div>
          </div>
        </td>
        <td class="r">${fmtMoney(r.value)}</td>
        <td class="r"><span class="badge ${pnlClass}">${fmtPct(r.pnl)}</span></td>
        <td>${escapeHtml(r.style)}</td>
        <td class="r">${(r.dd * 100).toFixed(1)}%</td>
        <td class="r">${(r.turnover * 100).toFixed(0)}%</td>
        <td>${statusBadge}</td>
      `;
      tr.addEventListener("click", () => {
        selectedModel = r.id;
        modelSel.value = r.id;
        renderFeed();
        renderPositions();
        window.location.hash = "#models";
      });
      lbBody.appendChild(tr);
    });
  }

  function statusToBadge(s) {
    if (s === "Risk") return `<span class="badge warn">RISK</span>`;
    if (s === "Hot") return `<span class="badge warn">HOT</span>`;
    return `<span class="badge good">OK</span>`;
  }

  function colorFor(id) {
    const m = MODELS.find(x => x.id === id);
    return m ? m.color : "#e9eaf1";
  }

  // ------------------------------------------------------------
  // Contestants mini list + legend
  // ------------------------------------------------------------
  const contestants = $("#contestants");
  const miniLegend = $("#miniLegend");
  function renderContestants() {
    contestants.innerHTML = "";
    MODELS.forEach(m => {
      const div = document.createElement("div");
      div.className = "mini-card";
      div.innerHTML = `
        <div>
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="tag">${escapeHtml(m.style)}</div>
        </div>
        <div class="badge" style="border-color:${m.color}; color:${m.color}">MODEL</div>
      `;
      contestants.appendChild(div);
    });

    miniLegend.innerHTML = "";
    MODELS.slice(0, 3).forEach(m => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<span class="sw" style="background:${m.color}"></span><span>${escapeHtml(m.name)}</span>`;
      miniLegend.appendChild(item);
    });
  }

  // ------------------------------------------------------------
  // Risk cards (top right)
  // ------------------------------------------------------------
  const riskGrid = $("#riskGrid");
  function renderRisk() {
    const s = series[selectedModel];
    const cards = [
      { k: "Exposure", v: (s.exposure * 100).toFixed(0) + "%", p: s.exposure },
      { k: "Drawdown", v: (s.dd * 100).toFixed(1) + "%", p: s.dd / 0.30 },
      { k: "Turnover", v: (s.turnover * 100).toFixed(0) + "%", p: s.turnover },
    ];
    riskGrid.innerHTML = "";
    cards.forEach(c => {
      const div = document.createElement("div");
      div.className = "risk";
      div.innerHTML = `
        <div class="k">${c.k.toUpperCase()}</div>
        <div class="v">${c.v}</div>
        <div class="bar"><div style="width:${clamp(c.p, 0, 1) * 100}%"></div></div>
      `;
      riskGrid.appendChild(div);
    });
  }

  // ------------------------------------------------------------
  // Feed + Positions
  // ------------------------------------------------------------
  const feedEl = $("#feed");
  const posGrid = $("#posGrid");

  function pushFeed(id, item) {
    const s = series[id];
    s.feed.unshift(item);
    if (s.feed.length > 60) s.feed.length = 60;
  }

  function renderFeed() {
    const s = series[selectedModel];
    feedEl.innerHTML = "";
    s.feed.slice(0, 30).forEach(it => {
      const div = document.createElement("div");
      div.className = "feed-item";
      const kind = it.kind.toUpperCase();
      div.innerHTML = `
        <div class="meta">
          <span>${escapeHtml(kind)}</span>
          <span>${new Date(it.ts).toLocaleTimeString()}</span>
        </div>
        <div class="msg">${formatMsg(it.text)}</div>
      `;
      feedEl.appendChild(div);
    });
    if (s.feed.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No messages yet.";
      feedEl.appendChild(empty);
    }
  }

  function renderPositions() {
    const s = series[selectedModel];
    posGrid.innerHTML = "";
    s.positions.forEach(p => {
      const div = document.createElement("div");
      div.className = "pos";
      const badgeClass = p.side === "LONG" ? "good" : "bad";
      div.innerHTML = `
        <div class="sym">${escapeHtml(p.symbol)}</div>
        <div class="row"><div class="k">Size</div><div class="v">${p.size}</div></div>
        <div class="row"><div class="k">Entry</div><div class="v">${p.entry.toFixed(2)}</div></div>
        <div class="row"><div class="k">Stop</div><div class="v">${p.stop.toFixed(2)}</div></div>
        <div class="row"><div class="k">TP</div><div class="v">${p.tp.toFixed(2)}</div></div>
        <div class="side">
          <span class="badge ${badgeClass}">${p.side}</span>
          <span class="muted">${(p.leverage).toFixed(1)}x</span>
        </div>
      `;
      posGrid.appendChild(div);
    });
  }

  function formatMsg(t) {
    // very light formatting
    return escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br/>");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ------------------------------------------------------------
  // Synthetic generators
  // ------------------------------------------------------------
  function synthDecision(id, value) {
    const s = series[id];
    const pnl = pnlPct(id);
    const dd = s.dd;

    const bias = id === "deepseek" ? "tactical" :
                 id === "claude"   ? "risk-first" :
                 id === "gemini"   ? "high-frequency" :
                 id === "grok"     ? "trend" : "balanced";

    const actions = [
      `Maintain exposure; wait for confirmation.`,
      `Trim risk; reduce leverage until volatility cools.`,
      `Add position on breakout; tight stop placement.`,
      `Rotate to relative-strength pair; keep turnover budget.`,
      `Hold core; hedge tail risk with small short.`,
      `Take profit into strength; re-enter on pullback.`,
    ];

    const action = actions[Math.floor(rng() * actions.length)];
    const conf = clamp(0.55 + rng() * 0.35 - dd * 0.4, 0.20, 0.90);

    const text =
      `Bias: **${bias}** · Confidence: **${Math.round(conf * 100)}%**\n` +
      `Account: ${fmtMoney(value)} (${fmtPct(pnl)}) · Drawdown: ${(dd*100).toFixed(1)}%\n` +
      `${action}`;

    return { kind: "signal", text, ts: now() };
  }

  function synthPositions(id, value) {
    // small set of pseudo instruments
    const symbols = ["BTC", "ETH", "SOL", "DOGE", "XRP", "BNB"];
    const n = 2 + Math.floor(rng() * 3);
    const out = [];
    for (let i = 0; i < n; i++) {
      const sym = symbols[(i + Math.floor(rng() * symbols.length)) % symbols.length] + "-PERP";
      const side = rng() > 0.48 ? "LONG" : "SHORT";
      const entry = (100 + rng() * 900) * (sym.startsWith("BTC") ? 60 : sym.startsWith("ETH") ? 20 : 1.2);
      const leverage = 1 + rng() * (id === "deepseek" || id === "gemini" ? 6 : 4);
      const stop = entry * (side === "LONG" ? (1 - (0.01 + rng() * 0.03)) : (1 + (0.01 + rng() * 0.03)));
      const tp = entry * (side === "LONG" ? (1 + (0.015 + rng() * 0.06)) : (1 - (0.015 + rng() * 0.06)));
      const size = Math.round((value / 9000) * (0.2 + rng() * 0.8) * 10) / 10;
      out.push({ symbol: sym, side, entry, stop, tp, leverage, size });
    }
    return out;
  }

  // ------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------
  async function tick() {
    if (paused) return;
    const snap = await dataAdapter.fetchSnapshot();

    // Update timestamps
    tsLabel.textContent = `Updated ${snap.ts.toLocaleString()}`;
    lastTick.textContent = `Last tick: ${snap.ts.toLocaleTimeString()}`;

    // Update chart labels
    const n = series[MODELS[0].id].values.length;
    mainChart.data.labels = labelsFromLen(n);
    MODELS.forEach((m, i) => {
      mainChart.data.datasets[i].data = series[m.id].values.slice();
    });
    mainChart.update("none");

    // hero chart (first 3 models)
    heroChart.data.labels = labelsFromLen(40);
    heroChart.data.datasets.forEach((ds, i) => {
      const mid = MODELS[i].id;
      ds.data = series[mid].values.slice(-40);
    });
    heroChart.update("none");

    renderLeaderboard();
    renderRisk();
    renderFeed();
    renderPositions();
  }

  function boot() {
    $("#startCapLabel").textContent = fmtMoney(START_CAPITAL);
    liveChip.className = "chip live";
    renderContestants();

    // Seed initial feed and positions
    MODELS.forEach(m => {
      for (let k = 0; k < 6; k++) pushFeed(m.id, synthDecision(m.id, currentValue(m.id)));
      series[m.id].positions = synthPositions(m.id, currentValue(m.id));
    });

    renderLeaderboard();
    renderRisk();
    renderFeed();
    renderPositions();

    // Start loop
    tick();
    setInterval(() => { tick().catch(console.error); }, UPDATE_MS);
  }

  boot();
})();
