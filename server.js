"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;
const CATS = ["renda", "luzgas", "agua", "tel"];

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
    category    text    not null check (category in ('renda','luzgas','agua','tel')),
    amount      numeric(10,2),
    paid        boolean not null default false,
    updated_at  timestamptz not null default now(),
    primary key (year, month, category)
  );
  create table if not exists app_config (
    id           integer primary key default 1 check (id = 1),
    start_year   integer not null,
    start_month  integer not null check (start_month between 1 and 12)
  );
`;

// Bases de dados criadas antes de Luz e Gás serem uma só despesa:
// soma luz + gás de cada mês numa linha "luzgas" e atualiza a regra das categorias.
// Pode correr várias vezes sem efeito (idempotente).
async function mergeLuzGas() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "alter table payments drop constraint if exists payments_category_check",
    );
    await client.query(
      `insert into payments (year, month, category, amount, paid)
         select year, month, 'luzgas', sum(amount), min(case when paid then 1 else 0 end) = 1
           from payments
          where category in ('luz', 'gas')
          group by year, month
       on conflict (year, month, category) do nothing`,
    );
    await client.query("delete from payments where category in ('luz', 'gas')");
    await client.query(
      "alter table payments add constraint payments_category_check check (category in ('renda','luzgas','agua','tel'))",
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(SCHEMA);
      await mergeLuzGas();
      console.log("Base de dados pronta.");
      return;
    } catch (err) {
      console.log(
        `A aguardar pela base de dados (${attempt}/30): ${err.message}`,
      );
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
  if (!Number.isFinite(n) || n < 0 || n > 99999999)
    throw new Error("valor inválido");
  return Math.round(n * 100) / 100;
}
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (!err.status) console.error(err);
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : "erro interno" });
  });
function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

/* ---------- API ---------- */
app.get(
  "/api/health",
  wrap(async (_req, res) => {
    await pool.query("select 1");
    res.json({ ok: true });
  }),
);

// Um ano completo: ordenado base, ordenados por mês e pagamentos.
app.get(
  "/api/year/:year",
  wrap(async (req, res) => {
    const year = parseYear(req.params.year);
    if (!year) throw bad("ano inválido");
    const [s, ms, p] = await Promise.all([
      pool.query("select salary from settings where year = $1", [year]),
      pool.query("select month, salary from month_salary where year = $1", [
        year,
      ]),
      pool.query(
        "select month, category, amount, paid from payments where year = $1",
        [year],
      ),
    ]);
    const months = {};
    const at = (m) => (months[m] = months[m] || {});
    ms.rows.forEach((r) => {
      at(r.month).sal = num(r.salary);
    });
    p.rows.forEach((r) => {
      at(r.month)[r.category] = { v: num(r.amount), p: r.paid };
    });
    res.json({
      year,
      salary: s.rows[0] ? num(s.rows[0].salary) : null,
      months,
    });
  }),
);

// Grava um ano completo (substitui o que existia para esse ano).
app.put(
  "/api/year/:year",
  wrap(async (req, res) => {
    const year = parseYear(req.params.year);
    if (!year) throw bad("ano inválido");
    const body = req.body || {};
    let salary, months;
    try {
      salary = money(body.salary);
      months =
        body.months && typeof body.months === "object" ? body.months : {};
    } catch (e) {
      throw bad(e.message);
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from payments where year = $1", [year]);
      await client.query("delete from month_salary where year = $1", [year]);
      await client.query("delete from settings where year = $1", [year]);
      if (salary !== null)
        await client.query(
          "insert into settings (year, salary) values ($1, $2)",
          [year, salary],
        );
      for (let m = 1; m <= 12; m++) {
        const row = months[m];
        if (!row || typeof row !== "object") continue;
        const sal = money(row.sal);
        if (sal !== null)
          await client.query(
            "insert into month_salary (year, month, salary) values ($1, $2, $3)",
            [year, m, sal],
          );
        for (const cat of CATS) {
          const it = row[cat];
          if (!it || typeof it !== "object") continue;
          const amount = money(it.v);
          const paid = it.p === true;
          if (amount === null && !paid) continue;
          await client.query(
            "insert into payments (year, month, category, amount, paid) values ($1, $2, $3, $4, $5)",
            [year, m, cat, amount, paid],
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
  }),
);

// Início do registo (ano e mês a partir do qual se contam os dados).
async function getStart() {
  const r = await pool.query(
    "select start_year, start_month from app_config where id = 1",
  );
  return r.rows[0]
    ? {
        year: Number(r.rows[0].start_year),
        month: Number(r.rows[0].start_month),
      }
    : null;
}
app.get(
  "/api/config",
  wrap(async (_req, res) => {
    res.json({ start: await getStart() });
  }),
);
app.put(
  "/api/config",
  wrap(async (req, res) => {
    const year = parseYear(req.body && req.body.year);
    const month = Number(req.body && req.body.month);
    if (!year) throw bad("ano inválido");
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw bad("mês inválido");
    await pool.query("delete from app_config where id = 1");
    await pool.query(
      "insert into app_config (id, start_year, start_month) values (1, $1, $2)",
      [year, month],
    );
    res.json({ start: { year, month } });
  }),
);

// Totais acumulados dos anos anteriores a "before", a partir do início do registo.
app.get(
  "/api/totals",
  wrap(async (req, res) => {
    const before = parseYear(req.query.before);
    if (!before) throw bad("ano inválido");
    const start = await getStart();
    const from = start ? start.year * 12 + start.month : 0;
    const r = await pool.query(
      `select coalesce(sum(case when paid then amount end), 0) as paid,
            count(case when paid then 1 end)                  as paid_n,
            coalesce(sum(case when not paid then amount end), 0) as due,
            count(case when not paid then 1 end)              as due_n,
            count(distinct case when not paid then year * 12 + month end) as due_months
       from payments
      where amount is not null and year < $1 and (year * 12 + month) >= $2`,
      [before, from],
    );
    const x = r.rows[0];
    res.json({
      paid: Math.round(Number(x.paid) * 100) / 100,
      paidN: Number(x.paid_n),
      due: Math.round(Number(x.due) * 100) / 100,
      dueN: Number(x.due_n),
      dueMonths: Number(x.due_months),
    });
  }),
);

// Média mensal de cada despesa, por ano (sobre o valor total), a partir do início do registo.
app.get(
  "/api/averages",
  wrap(async (_req, res) => {
    const start = await getStart();
    const from = start ? start.year * 12 + start.month : 0;
    const r = await pool.query(
      `select year, category, avg(amount) as avg, count(*) as n
       from payments
      where amount is not null and (year * 12 + month) >= $1
      group by year, category
      order by year, category`,
      [from],
    );
    res.json({
      rows: r.rows.map((x) => ({
        year: Number(x.year),
        category: x.category,
        avg: Math.round(Number(x.avg) * 100) / 100,
        n: Number(x.n),
      })),
    });
  }),
);

app.use("/api", (_req, res) =>
  res.status(404).json({ error: "não encontrado" }),
);

migrate()
  .then(() =>
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`Contas da Casa em http://localhost:${PORT}`),
    ),
  )
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
