# Contas da Casa

Aplicação pessoal para registar rendas e contas (renda, luz, gás, água e telecomunicações), com histórico em PostgreSQL.

## Arrancar

Precisa do Docker Desktop (ou Docker Engine com o plugin Compose).

```bash
docker compose up -d --build
```

Abra http://localhost:3000. Na primeira vez a base de dados é criada sozinha.
A aplicação só fica acessível neste computador (127.0.0.1).

Comandos úteis:

```bash
docker compose ps          # ver o estado
docker compose logs -f app # ver os registos da aplicação
docker compose stop        # parar (os dados mantêm-se)
docker compose up -d       # voltar a arrancar
```

Os dados ficam no volume Docker `pgdata`. `docker compose down` mantém-nos;
`docker compose down -v` apaga-os de vez. Não use o `-v` sem ter uma cópia de segurança.

## Cópia de segurança

```bash
# guardar
docker compose exec -T db pg_dump -U contas contas > backup-$(date +%F).sql

# repor (numa base de dados vazia)
docker compose exec -T db psql -U contas contas < backup-AAAA-MM-DD.sql
```

Guarde as cópias fora desta pasta (por exemplo na cloud ou num disco externo).

## Estrutura da base de dados

| Tabela | Conteúdo |
|---|---|
| `payments` | uma linha por ano, mês e despesa: `amount` (valor total) e `paid` (pago) |
| `settings` | ordenado base de cada ano |
| `month_salary` | ordenado de um mês concreto, quando difere do base |

Para ligar o DBeaver ou o psql, retire o `#` das linhas `ports` do serviço `db` em `docker-compose.yml`
(utilizador `contas`, palavra-passe `contas_local`, base `contas`, porta 5432).

## Importar o histórico (2022 em diante)

Pode introduzir os meses na própria página (mude de ano com as setas) ou inserir diretamente na tabela `payments`.
Exemplo de importação a partir de um CSV com as colunas `year,month,category,amount,paid`
(categorias: `renda`, `luz`, `gas`, `agua`, `tel`):

```bash
docker compose cp historico.csv db:/tmp/historico.csv
docker compose exec db psql -U contas contas -c "\copy payments (year, month, category, amount, paid) from '/tmp/historico.csv' csv header"
```

## Desenvolvimento

O ecrã está em `public/index.html` e a API em `server.js`. Depois de alterar, volte a correr
`docker compose up -d --build`.
