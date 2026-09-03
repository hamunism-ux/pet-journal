import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const looksReal = (v) => typeof v === "string" && v.length > 20 && !v.startsWith("PASTE_");
export const supabaseConfigured = looksReal(SUPABASE_URL) && looksReal(SUPABASE_ANON_KEY);
export const supabase = supabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
