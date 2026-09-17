// Pone en MySQL los mismos nombres que acaba de recibir figures_seed.json.
// La siembra no toca filas existentes, así que sin esto la app seguiría
// mostrando los nombres viejos. Se ejecuta desde backend/ para leer su .env.
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const slugs = ["conejo_sentado", "canguro", "cisne", "vela", "molino"];
const semilla = JSON.parse(readFileSync("../vision-service/data/figures_seed.json", "utf-8"));

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  charset: "utf8mb4",
});
for (const slug of slugs) {
  const f = semilla.find(x => x.slug === slug);
  const [r] = await conn.query(
    "UPDATE figures SET name = ?, emoji = ?, description = ?, category = ? WHERE slug = ?",
    [f.name, f.emoji, f.description, f.category, slug],
  );
  console.log(`${slug.padEnd(15)} -> ${f.name.padEnd(8)} ${f.emoji}  filas: ${r.affectedRows}`);
}
const [filas] = await conn.query("SELECT slug, name, emoji, category, enabled FROM figures WHERE enabled = 1 ORDER BY id");
console.table(filas);
await conn.end();
