/* Supabase 連線。兩個值都來自 Supabase 後台 Settings → API。
   anon key 是設計成可以放在前端的（真正的門鎖是資料表上的 RLS 規則，見 supabase/schema.sql）。 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(url && key);
export const supabase = supabaseConfigured ? createClient(url, key) : null;
