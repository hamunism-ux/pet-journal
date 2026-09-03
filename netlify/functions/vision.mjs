/* 後端 Function：把照片和提示詞交給 Claude，回傳結果。
   前端的三個功能（讀成分表、讀條碼數字、猜品種）都走這一支。

   為什麼需要它：Anthropic 的 API 金鑰不能放在前端，任何人打開網頁原始碼都看得到。
   金鑰只放在 Netlify 的環境變數 ANTHROPIC_API_KEY，只有這支程式讀得到。

   為什麼要驗登入：不然任何人找到這個網址都能免費用你的金鑰。
   前端會附上 Supabase 的登入 token，這裡先問 Supabase「這個人真的登入了嗎」。 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../src/config.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function isSignedIn(authHeader) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);
  if (!(await isSignedIn(req.headers.get("authorization")))) return json({ error: "sign in required" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { image, prompt, max_tokens = 1000 } = body || {};
  if (!image || !prompt) return json({ error: "image and prompt are required" }, 400);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(Number(max_tokens) || 1000, 2000),
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  const data = await r.json();
  return json(data, r.ok ? 200 : r.status);
};
