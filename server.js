"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;
const CATS = ["renda", "luz", "gas", "agua", "tel"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Esquema ---------- */
const SCHEMA = `
  create table if not exists settings (
    year    integer primary key,
    salary  numeric(10,2)
  );
  create table if not exists month_salary (
    year    integer not null,
    month   integer not null check (month between 1 and 12),
    salary  numeric(10,2) not null,
    primary key (year, month)
  );
  create table if not exists payments (
    year        integer not null,
    month       integer not null check (month between 1 and 12),
    category    text    not null check (category in ('renda','luz','gas','agua','tel')),
    amount      numeric(10,2),
    paid        boolean not null default false,
    updated_at  timestamptz not null default now(),
    primary key (year, month, category)
  );
`;

async function migrate() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(SCHEMA);
      console.log("Base de dados pronta.");
      return;
    } catch (err) {
      console.log(`A aguardar pela base de dados (${attempt}/30): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Não foi possível ligar à base de dados.");
}

/* ---------- Utilitários ---------- */
const num = (v) => (v === null || v === undefined ? null : Number(v));
function parseYear(raw) {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
}
function money(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) throw new Error("valor inválido");
  return Math.round(n * 100) / 100;
}
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "erro interno" });
  });
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

/* ---------- API ---------- */
app.get("/api/health", wrap(async (_req, res) => {
  await pool.query("select 1");
  res.json({ ok: true });
}));

// Um ano completo: ordenado base, ordenados por mês e pagamentos.
app.get("/api/year/:year", wrap(async (req, res) => {
  const year = parseYear(req.params.year);
  if (!year) throw bad("ano inválido");
  const [s, ms, p] = await Promise.all([
    pool.query("select salary from settings where year = $1", [year]),
    pool.query("select month, salary from month_salary where year = $1", [year]),
    pool.query("select month, category, amount, paid from payments where year = $1", [year]),
  ]);
  const months = {};
  const at = (m) => (months[m] = months[m] || {});
  ms.rows.forEach((r) => { at(r.month).sal = num(r.salary); });
  p.rows.forEach((r) => { at(r.month)[r.category] = { v: num(r.amount), p: r.paid }; });
  res.json({ year, salary: s.rows[0] ? num(s.rows[0].salary) : null, months });
}));

// Grava um ano completo (substitui o que existia para esse ano).
app.put("/api/year/:year", wrap(async (req, res) => {
  const year = parseYear(req.params.year);
  if (!year) throw bad("ano inválido");
  const body = req.body || {};
  let salary, months;
  try {
    salary = money(body.salary);
    months = body.months && typeof body.months === "object" ? body.months : {};
  } catch (e) { throw bad(e.message); }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from payments where year = $1", [year]);
    await client.query("delete from month_salary where year = $1", [year]);
    await client.query("delete from settings where year = $1", [year]);
    if (salary !== null) await client.query("insert into settings (year, salary) values ($1, $2)", [year, salary]);
    for (let m = 1; m <= 12; m++) {
      const row = months[m];
      if (!row || typeof row !== "object") continue;
      const sal = money(row.sal);
      if (sal !== null) await client.query("insert into month_salary (year, month, salary) values ($1, $2, $3)", [year, m, sal]);
      for (const cat of CATS) {
        const it = row[cat];
        if (!it || typeof it !== "object") continue;
        const amount = money(it.v);
        const paid = it.p === true;
        if (amount === null && !paid) continue;
        await client.query(
          "insert into payments (year, month, category, amount, paid) values ($1, $2, $3, $4, $5)",
          [year, m, cat, amount, paid]
        );
      }
    }
    await client.query("commit");
    res.json({ ok: true });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// Média mensal de cada despesa, por ano (sobre o valor total).
app.get("/api/averages", wrap(async (_req, res) => {
  const r = await pool.query(
    `select year, category, avg(amount) as avg, count(*) as n
       from payments
      where amount is not null
      group by year, category
      order by year, category`
  );
  res.json({
    rows: r.rows.map((x) => ({
      year: Number(x.year),
      category: x.category,
      avg: Math.round(Number(x.avg) * 100) / 100,
      n: Number(x.n),
    })),
  });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "não encontrado" }));

migrate()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`Contas da Casa em http://localhost:${PORT}`)))
  .catch((err) => { console.error(err.message); process.exit(1); });
