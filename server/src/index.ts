import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProjects, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
const isProd = process.env.NODE_ENV === "production";

const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await fetchProjects();
    res.set("Cache-Control", "public, max-age=60");
    res.json({ projects });
  } catch (err) {
    console.error("[api/projects]", err);
    res.status(500).json({ error: "db_error" });
  }
});

if (isProd) {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(
    express.static(clientDist, {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`[projectsflow] listening on http://127.0.0.1:${port} (${process.env.NODE_ENV ?? "development"})`);
});
