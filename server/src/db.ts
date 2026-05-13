import mysql from "mysql2/promise";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const socketPath = process.env.DB_SOCKET;
export const pool = mysql.createPool({
  ...(socketPath
    ? { socketPath }
    : {
        host: required("DB_HOST"),
        port: Number(process.env.DB_PORT ?? 3306),
      }),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  database: required("DB_NAME"),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  queueLimit: 0,
  dateStrings: true,
  charset: "utf8mb4",
});

export type Project = {
  id: number;
  slug: string;
  title: string;
  year: number;
  period: string;
  category: string;
  summary: string;
  body: string;
  tags: string[];
  outcome: string | null;
  client: string | null;
  status: "live" | "archived" | "in-progress";
  sort_order: number;
};

type ProjectRow = Omit<Project, "tags"> & { tags: string };

export const fetchProjects = async (): Promise<Project[]> => {
  const [rows] = await pool.query<ProjectRow[] & mysql.RowDataPacket[]>(
    `SELECT id, slug, title, year, period, category, summary, body,
            tags, outcome, client, status, sort_order
       FROM projects
      WHERE status <> 'hidden'
      ORDER BY year DESC, sort_order ASC, id ASC`,
  );

  return rows.map((row) => ({
    ...row,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  }));
};
