//CommonJS way
// require("dotenv/config");
// const pg = require("pg");
// const db = new pg.Client(process.env.DATABASE_URL);
// module.exports = db;

//ESM Way
import "dotenv/config";
import pg from "pg";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

db.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

export default db;