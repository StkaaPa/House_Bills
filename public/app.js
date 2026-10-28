(function () {
  var CATS = [["renda", "Renda"], ["luzgas", "Luz e Gás"], ["agua", "Água"], ["tel", "Telecomunicações"]];
  var MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  var eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  var dec = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var pctFmt = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NOW = new Date();

  var state = { year: NOW.getFullYear(), salary: null, months: blank(), start: null };
  var prev = { paid: 0, paidN: 0, due: 0, dueN: 0, dueMonths: 0 }; // totais dos anos anteriores
  var loaded = false, dirty = false, saving = false, again = false, timer = null;

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $("rows");

  function blank() {
    var o = {};
    for (var m = 1; m <= 12; m++) {
      o[m] = { sal: null };
      CATS.forEach(function (c) { o[m][c[0]] = { v: null, p: false }; });
    }
    return o;
  }
  function parse(s) {
    if (!s) return null;
    s = String(s).replace(/\s|€/g, "");
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  function show(v) { return v == null ? "" : dec.format(v); }
  // Um mês conta se for igual ou posterior ao início do registo.
  function inRange(m) {
    var s = state.start;
    return !s || state.year * 12 + m >= s.year * 12 + s.month;
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------- Linhas ---------- */
  function buildRows() {
    var html = "";
    for (var m = 1; m <= 12; m++) {
      var isNow = state.year === NOW.getFullYear() && m === NOW.getMonth() + 1;
      html += '<div class="row' + (isNow ? " now" : "") + '" data-m="' + m + '"' + (isNow ? ' aria-current="date"' : "") + ">";
      html += '<div class="mes"><strong>' + MESES[m - 1] + ' <span class="yr">' + state.year + "</span></strong>" +
        (isNow ? '<span class="tag">Mês atual</span>' : "") + '<span class="chip" id="chip-' + m + '">Sem valores</span></div>';
      CATS.forEach(function (c) {
        var k = c[0], it = state.months[m][k];
        html += '<div class="cell" data-k="' + k + '" data-label="' + c[1] + '">' +
          '<div class="vbox"><input class="field v" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" id="v-' + m + "-" + k + '" data-m="' + m + '" data-k="' + k + '" aria-label="' + c[1] + " de " + MESES[m - 1] + ', valor em euros" value="' + show(it.v) + '"><span class="half" id="h-' + m + "-" + k + '"></span></div>' +
          '<label class="paidline" for="p-' + m + "-" + k + '"><input class="sr" type="checkbox" id="p-' + m + "-" + k + '" data-m="' + m + '" data-k="' + k + '" aria-label="' + c[1] + " de " + MESES[m - 1] + ' paga"' + (it.p ? " checked" : "") + '>' +
          '<span class="pill"><span class="t-off">Por pagar</span><span class="t-on">Pago</span></span></label></div>';
      });
      html += '<div class="tot">' +
        '<div class="tl big"><span class="lbl">Total do mês</span><span class="val" id="tot-' + m + '">—</span></div>' +
        '<div class="tl"><span class="lbl">A tua parte (½)</span><span class="val" id="shr-' + m + '">—</span></div>' +
        '<div class="tl"><span class="lbl">Peso da tua parte</span><span class="val" id="pct-' + m + '">—</span></div>' +
        '<div class="bar" aria-hidden="true"><i id="bar-' + m + '"></i></div>' +
        '<div class="tl sal"><label class="lbl" for="s-' + m + '">Ordenado</label>' +
        '<input class="field salin" type="text" inputmode="decimal" autocomplete="off" id="s-' + m + '" data-m="' + m + '" data-sal="1" placeholder="base" aria-label="Ordenado de ' + MESES[m - 1] + ', se diferente do base" value="' + show(state.months[m].sal) + '"></div>' +
        "</div></div>";
    }
    rowsEl.innerHTML = html;
    refresh();
  }

  /* ---------- Cálculos ---------- */
  function refresh() {
    var paid = 0, due = 0, nPaid = 0, nDue = 0, monthsDue = 0;
    var sums = {}, counts = {}, pcts = [];
    var paidS = {}, dueS = {};
    CATS.forEach(function (c) { sums[c[0]] = 0; counts[c[0]] = 0; paidS[c[0]] = 0; dueS[c[0]] = 0; });

    for (var m = 1; m <= 12; m++) {
      var row = rowsEl.children[m - 1], mDue = 0, mPaid = 0, total = 0;
      row.dataset.out = inRange(m) ? "" : "1";
      if (!inRange(m)) { row.dataset.due = ""; continue; }
      CATS.forEach(function (c) {
        var k = c[0], it = state.months[m][k];
        var cell = row.querySelector('.cell[data-k="' + k + '"]');
        var has = it.v != null;
        cell.classList.toggle("is-paid", has && it.p);
        cell.classList.toggle("is-due", has && !it.p);
        $("h-" + m + "-" + k).textContent = has ? "Metade: " + eur.format(it.v / 2) : "";
        if (has) {
          total += it.v; sums[k] += it.v; counts[k]++;
          if (it.p) paidS[k] += it.v; else dueS[k] += it.v;
          if (it.p) { paid += it.v; nPaid++; mPaid++; } else { due += it.v; nDue++; mDue++; }
        }
      });
      var chip = $("chip-" + m);
      chip.className = "chip" + (mDue ? " due" : mPaid ? " ok" : "");
      chip.textContent = mDue ? mDue + " em falta" : mPaid ? "Tudo pago" : "Sem valores";
      row.dataset.due = mDue ? "1" : "";
      if (mDue) monthsDue++;

      var sal = state.months[m].sal != null ? state.months[m].sal : state.salary;
      var salIn = $("s-" + m);
      salIn.placeholder = state.salary != null ? show(state.salary) : "base";
      $("tot-" + m).textContent = total > 0 ? eur.format(total) : "—";
      var pct = total > 0 && sal > 0 ? (total / 2) / sal * 100 : null;
      $("shr-" + m).textContent = total > 0 ? eur.format(total / 2) : "—";
      $("pct-" + m).textContent = pct == null ? "—" : pctFmt.format(pct) + " %";
      $("bar-" + m).style.width = pct == null ? "0" : Math.min(100, pct) + "%";
      if (pct != null) pcts.push(pct);
    }

    // Resumo do topo: acumulado dos anos anteriores + ano em edição.
    var paidC = prev.paid + paid, dueC = prev.due + due;
    var nPaidC = prev.paidN + nPaid, nDueC = prev.dueN + nDue, monthsDueC = prev.dueMonths + monthsDue;
    var carried = prev.paidN + prev.dueN > 0;
    $("sumPaid").textContent = eur.format(paidC);
    $("subPaid").textContent = plural(nPaidC, "pagamento", "pagamentos") + (carried ? " · em " + state.year + ": " + eur.format(paid) : "");
    $("sumDue").textContent = eur.format(dueC);
    $("subDue").textContent = nDueC
      ? plural(nDueC, "pagamento", "pagamentos") + " em " + plural(monthsDueC, "mês", "meses") + (carried ? " · em " + state.year + ": " + eur.format(due) : "")
      : "Nada em falta";
    $("sumAll").textContent = eur.format(paidC + dueC);
    $("subAll").textContent = (nPaidC + nDueC) ? plural(nPaidC + nDueC, "valor registado", "valores registados") + (carried ? " · em " + state.year + ": " + eur.format(paid + due) : "") : "Preencha os valores abaixo";
    var s0 = state.start;
    $("cumNote").textContent = s0
      ? "Totais acumulados desde " + MESES[s0.month - 1] + " de " + s0.year + " até ao fim de " + state.year + "."
      : "Totais de " + state.year + ".";

    var html = "", avgTotal = 0, any = false;
    CATS.forEach(function (c) {
      var k = c[0], n = counts[k], avg = n ? sums[k] / n : null;
      if (avg != null) { avgTotal += avg; any = true; }
      html += '<div class="avg"><p class="label">' + c[1] + '</p><p class="value">' + (avg == null ? "—" : eur.format(avg)) +
        '</p><p class="sub">' + (n ? plural(n, "mês", "meses") + " · total " + eur.format(sums[k]) : "Sem valores") + "</p></div>";
    });
    html += '<div class="avg total"><p class="label">Custo médio mensal</p><p class="value">' + (any ? eur.format(avgTotal) : "—") + '</p><p class="sub">Soma das médias</p></div>';
    var avgPct = pcts.length ? pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length : null;
    html += '<div class="avg total"><p class="label">Peso médio no ordenado</p><p class="value">' + (avgPct == null ? "—" : pctFmt.format(avgPct) + " %") +
      '</p><p class="sub">' + (avgPct == null ? "Indique o ordenado" : "média de " + plural(pcts.length, "mês", "meses") + " (a tua parte)") + "</p></div>";
    $("avgs").innerHTML = html;

    var ph = "";
    CATS.forEach(function (c) {
      var k = c[0];
      ph += '<div class="avg"><p class="label">' + c[1] + '</p><p class="value">' + eur.format(paidS[k]) + '</p>' +
        '<p class="sub">A tua parte: ' + eur.format(paidS[k] / 2) + '</p>' +
        '<p class="sub">' + (dueS[k] > 0 ? "Em falta: " + eur.format(dueS[k]) : paidS[k] > 0 ? "Tudo pago" : "Sem pagamentos") + '</p></div>';
    });
    ph += '<div class="avg total"><p class="label">Total pago</p><p class="value">' + eur.format(paid) + '</p>' +
      '<p class="sub">A tua parte: ' + eur.format(paid / 2) + '</p></div>';
    $("paidCats").innerHTML = ph;
    $("paidNote").textContent = "Soma dos pagamentos marcados como pagos em " + state.year + ".";
    $("avgNote").textContent = "Média dos meses com valor registado em " + state.year + ".";
    applyFilter();
  }

  function applyFilter() {
    var only = $("onlyDue").checked, visible = 0;
    Array.prototype.forEach.call(rowsEl.children, function (row) {
      var hide = row.dataset.out === "1" || (only && !row.dataset.due);
      row.hidden = hide;
      if (!hide) visible++;
    });
    $("emptyMsg").hidden = visible > 0;
  }

  /* ---------- Guardar e carregar ---------- */
  function setStatus(t, err) { var s = $("status"); s.textContent = t; s.className = "status" + (err ? " err" : ""); }

  function payload() {
    var out = {};
    for (var m = 1; m <= 12; m++) {
      out[m] = { sal: state.months[m].sal };
      CATS.forEach(function (c) { var it = state.months[m][c[0]]; out[m][c[0]] = { v: it.v, p: !!it.p }; });
    }
    return out;
  }
  async function persist() {
    dirty = false;
    var year = state.year;
    var res = await fetch("/api/year/" + year, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salary: state.salary, months: payload() }),
      keepalive: true
    });
    if (!res.ok) throw new Error("http " + res.status);
  }
  async function flush() {
    if (saving) { again = true; return; }
    saving = true;
    try { await persist(); setStatus("Guardado"); loadAverages(); }
    catch (e) { dirty = true; setStatus("Não foi possível guardar. Tente novamente.", true); }
    saving = false;
    if (again) { again = false; flush(); }
  }
  function queueSave() {
    if (!loaded) return;
    dirty = true; setStatus("A guardar…");
    clearTimeout(timer); timer = setTimeout(flush, 500);
  }

  function merge(raw) {
    var base = blank();
    if (raw) {
      for (var m = 1; m <= 12; m++) {
        if (!raw[m]) continue;
        if (typeof raw[m].sal === "number") base[m].sal = raw[m].sal;
        CATS.forEach(function (c) {
          var s = raw[m][c[0]];
          if (s) base[m][c[0]] = { v: typeof s.v === "number" ? s.v : null, p: !!s.p };
        });
      }
    }
    return base;
  }

  async function loadPrev(year) {
    var t = { paid: 0, paidN: 0, due: 0, dueN: 0, dueMonths: 0 };
    try {
      var r = await fetch("/api/totals?before=" + year);
      if (r.ok) t = await r.json();
    } catch (e) { /* sem totais anteriores: mostra só o ano */ }
    return t;
  }

  async function loadYear() {
    loaded = false;
    setStatus("A carregar…");
    var raw = null, sal = null, failed = false;
    try {
      var res = await fetch("/api/year/" + state.year);
      if (!res.ok) throw new Error("http " + res.status);
      var d = await res.json();
      raw = d.months;
      sal = typeof d.salary === "number" ? d.salary : null;
    } catch (e) { failed = true; }
    state.months = merge(raw);
    state.salary = sal;
    $("salary").value = show(sal);
    var yr = state.year;
    var t = await loadPrev(yr);
    if (yr !== state.year) return; // o utilizador mudou de ano entretanto
    prev = t;
    buildRows();
    $("localNote").hidden = !failed;
    loaded = !failed; // não grava por cima de dados reais se a leitura falhou
    setStatus(failed ? "Não foi possível carregar os dados." : "", failed);
  }

  function updateNav() {
    $("prev").disabled = !!state.start && state.year <= state.start.year;
  }

  async function changeYear(delta) {
    if (delta < 0 && state.start && state.year + delta < state.start.year) return;
    clearTimeout(timer);
    if (dirty && loaded) { try { await persist(); } catch (e) {} }
    state.year += delta;
    $("yearLabel").textContent = state.year;
    updateNav();
    await loadYear();
  }

  /* ---------- Início do registo ---------- */
  async function loadConfig() {
    try {
      var r = await fetch("/api/config");
      if (!r.ok) throw new Error("http " + r.status);
      var d = await r.json();
      return { ok: true, start: d.start };
    } catch (e) { return { ok: false, start: null }; }
  }

  function fillSetupOptions() {
    var mo = "", yo = "";
    MESES.forEach(function (n, i) { mo += '<option value="' + (i + 1) + '">' + n + "</option>"; });
    for (var y = NOW.getFullYear() + 1; y >= 2000; y--) yo += '<option value="' + y + '">' + y + "</option>";
    $("setMonth").innerHTML = mo;
    $("setYear").innerHTML = yo;
  }

  function openSetup(first) {
    var s = state.start;
    $("setMonth").value = String(s ? s.month : NOW.getMonth() + 1);
    $("setYear").value = String(s ? s.year : NOW.getFullYear());
    $("setupTitle").textContent = first ? "Quando começou a registar?" : "Alterar o início do registo";
    $("setupNote").textContent = first
      ? "Escolha o mês e o ano do primeiro pagamento que quer registar. Os meses anteriores não aparecem nem entram nas médias."
      : "Os meses anteriores à nova data deixam de aparecer e de contar nas médias, mas os valores já registados não são apagados.";
    $("setupCancel").hidden = first;
    $("setupErr").textContent = "";
    $("setup").hidden = false;
    $("appBody").hidden = first;
    $("yearnav").hidden = first;
    $("sinceLine").hidden = first;
  }

  async function enterApp() {
    $("setup").hidden = true;
    $("appBody").hidden = false;
    $("yearnav").hidden = false;
    $("sinceLine").hidden = false;
    $("sinceText").textContent = "Registo desde " + MESES[state.start.month - 1] + " de " + state.start.year + ".";
    if (state.year < state.start.year) state.year = state.start.year;
    $("yearLabel").textContent = state.year;
    updateNav();
    await loadYear();
    loadAverages();
  }

  $("setupForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var y = Number($("setYear").value), m = Number($("setMonth").value);
    try {
      var r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: y, month: m })
      });
      if (!r.ok) throw new Error("http " + r.status);
    } catch (err) {
      $("setupErr").textContent = "Não foi possível guardar. Confirme que a base de dados está a correr e tente novamente.";
      return;
    }
    state.start = { year: y, month: m };
    await enterApp();
  });
  $("setupCancel").addEventListener("click", function () {
    $("setup").hidden = true;
    $("appBody").hidden = false;
    $("yearnav").hidden = false;
    $("sinceLine").hidden = false;
  });
  $("changeStart").addEventListener("click", function () { openSetup(false); $("setup").scrollIntoView({ block: "start" }); });

  /* ---------- Eventos ---------- */
  rowsEl.addEventListener("input", function (e) {
    var t = e.target;
    if (t.type !== "text") return;
    if (t.dataset.sal) state.months[t.dataset.m].sal = parse(t.value);
    else state.months[t.dataset.m][t.dataset.k].v = parse(t.value);
    refresh(); queueSave();
  });
  rowsEl.addEventListener("focusout", function (e) {
    var t = e.target;
    if (t.type !== "text") return;
    var v = t.dataset.sal ? state.months[t.dataset.m].sal : state.months[t.dataset.m][t.dataset.k].v;
    t.value = show(v);
  });
  rowsEl.addEventListener("change", function (e) {
    var t = e.target;
    if (t.type !== "checkbox") return;
    state.months[t.dataset.m][t.dataset.k].p = t.checked;
    refresh(); queueSave();
  });
  $("salary").addEventListener("input", function (e) { state.salary = parse(e.target.value); refresh(); queueSave(); });
  $("salary").addEventListener("focusout", function (e) { e.target.value = show(state.salary); });
  $("onlyDue").addEventListener("change", applyFilter);
  $("prev").addEventListener("click", function () { changeYear(-1); });
  $("next").addEventListener("click", function () { changeYear(1); });
  window.addEventListener("pagehide", function () { if (dirty && loaded) persist(); });

  /* ---------- Evolução das médias anuais ---------- */
  var SER = { renda: "--s1", luzgas: "--s2", agua: "--s3", tel: "--s4" };
  var avgData = null, evoCharts = [];
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  async function loadAverages() {
    try {
      var r = await fetch("/api/averages");
      if (!r.ok) throw new Error("http " + r.status);
      avgData = await r.json();
    } catch (e) { return; }
    drawEvolution();
  }

  function drawEvolution() {
    if (!avgData) return;
    evoCharts.forEach(function (c) { c.destroy(); });
    evoCharts = [];
    var by = {}, ys = [];
    CATS.forEach(function (c) { by[c[0]] = {}; });
    avgData.rows.forEach(function (r) {
      if (!by[r.category]) return;
      by[r.category][r.year] = r.avg;
      if (ys.indexOf(r.year) < 0) ys.push(r.year);
    });
    var host = $("evo");
    if (!ys.length) {
      host.innerHTML = '<p class="empty">Ainda sem dados. Preencha valores para ver a evolução.</p>';
      $("evoTable").innerHTML = "";
      return;
    }
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys), years = [];
    for (var y = min; y <= max; y++) years.push(y);

    function delta(k) {
      var have = years.filter(function (yy) { return by[k][yy] != null; });
      if (have.length < 2) return null;
      var last = have[have.length - 1], prev = have[have.length - 2];
      return { last: last, prev: prev, pct: (by[k][last] - by[k][prev]) / by[k][prev] * 100 };
    }
    function deltaText(d) {
      if (!d) return "Primeiro ano com registos";
      if (Math.abs(d.pct) < 0.05) return "● Sem variação face a " + d.prev;
      return (d.pct > 0 ? "▲ +" : "▼ ") + pctFmt.format(d.pct) + " % face a " + d.prev;
    }
    function deltaClass(d) { return !d || Math.abs(d.pct) < 0.05 ? "" : d.pct > 0 ? " up" : " down"; }

    var html = "";
    CATS.forEach(function (c) {
      var k = c[0], d = delta(k);
      var have = years.filter(function (yy) { return by[k][yy] != null; });
      var latest = have.length ? have[have.length - 1] : null;
      html += '<div class="avg mini"><div class="mh"><span class="dot" style="background:var(' + SER[k] + ')"></span><h3>' + c[1] + "</h3></div>" +
        '<p class="mv">' + (latest == null ? "—" : eur.format(by[k][latest]) + " <span>em " + latest + "</span>") + "</p>" +
        '<p class="md' + deltaClass(d) + '">' + deltaText(d) + "</p>" +
        '<div class="mc"><canvas id="evo-' + k + '" role="img" aria-label="Média anual de ' + c[1] + " de " + min + " a " + max + '"></canvas></div></div>';
    });
    host.innerHTML = html;

    if (typeof Chart !== "undefined") {
      Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
      var surface = css("--surface"), muted = css("--muted"), line = css("--line");
      CATS.forEach(function (c) {
        var k = c[0], col = css(SER[k]);
        evoCharts.push(new Chart($("evo-" + k), {
          type: "line",
          data: { labels: years, datasets: [{
            label: c[1],
            data: years.map(function (yy) { return by[k][yy] == null ? null : by[k][yy]; }),
            borderColor: col, backgroundColor: col, borderWidth: 2, tension: 0, spanGaps: false,
            pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: col, pointBorderColor: surface, pointBorderWidth: 2
          }] },
          options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function (ctx) { return " " + c[1] + ": " + eur.format(ctx.parsed.y); } } }
            },
            scales: {
              x: { grid: { display: false }, border: { color: line }, ticks: { color: muted, maxRotation: 0, autoSkip: true } },
              y: { grace: "10%", grid: { color: line }, border: { display: false },
                   ticks: { color: muted, maxTicksLimit: 4, callback: function (v) { return eur.format(v); } } }
            }
          }
        }));
      });
    }

    var th = "<thead><tr><th>Despesa</th>" + years.map(function (yy) { return "<th>" + yy + "</th>"; }).join("") + "<th>Variação</th></tr></thead>";
    var tb = "<tbody>" + CATS.map(function (c) {
      var k = c[0], d = delta(k);
      return "<tr><td>" + c[1] + "</td>" + years.map(function (yy) { return "<td>" + (by[k][yy] == null ? "—" : eur.format(by[k][yy])) + "</td>"; }).join("") +
        "<td>" + (d ? (d.pct > 0 ? "+" : "") + pctFmt.format(d.pct) + " %" : "—") + "</td></tr>";
    }).join("") + "</tbody>";
    $("evoTable").innerHTML = th + tb;
  }

  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var redraw = function () { drawEvolution(); };
    if (mq.addEventListener) mq.addEventListener("change", redraw);
  }

  /* ---------- Arranque ---------- */
  $("yearLabel").textContent = state.year;
  fillSetupOptions();
  buildRows();
  (async function init() {
    var cfg = await loadConfig();
    if (!cfg.ok) {
      $("localNote").hidden = false;
      setStatus("Não foi possível carregar os dados.", true);
      return;
    }
    if (!cfg.start) { openSetup(true); return; }
    state.start = cfg.start;
    await enterApp();
  })();
})();
