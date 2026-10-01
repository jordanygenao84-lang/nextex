import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, "../.env.local");
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [k, ...vParts] = trimmed.split("=");
    const v = vParts.join("=").trim();
    if (k.trim() === "NEXT_PUBLIC_SUPABASE_URL" && !supabaseUrl) supabaseUrl = v;
    if (k.trim() === "NEXT_PUBLIC_SUPABASE_ANON_KEY" && !supabaseAnonKey) supabaseAnonKey = v;
  }
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  console.log("Comprobando tablas de Fase 3 en Supabase Cloud...");
  const tables = ["conversations", "messages", "ai_requests", "ai_usage"];
  const results = {};

  for (const table of tables) {
    const { data, error, status } = await supabase.from(table).select("*").limit(1);
    results[table] = {
      status,
      exists: status !== 404 && !(error?.code === "PGRST204" || error?.message?.includes("does not exist")),
      error: error ? { message: error.message, code: error.code } : null,
      dataCount: Array.isArray(data) ? data.length : 0,
    };
  }

  console.log(JSON.stringify(results, null, 2));
}

checkTables();
