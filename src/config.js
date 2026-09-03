/* ===== 只有這個檔案需要你動手改 =====
   兩個值都在 Supabase 後台：Project Settings → API
   anon key 是設計來放前端的，公開沒關係（真正的門鎖是資料表的 RLS 規則）。 */

export const SUPABASE_URL = "https://wzuyfpkzasafysdlrykz.supabase.co/rest/v1/";      // 例如 https://abcdefgh.supabase.co
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dXlmcGt6YXNhZnlzZGxyeWt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDk1NjEsImV4cCI6MjEwNDAyNTU2MX0.xZiNMpfbc8eViHOZZYzKKpI8d5pbfpBQUf7ozv4Rc3g";    // 很長的一串，eyJ 開頭

/* 登入方式：
   "anonymous" = 打開網頁就自動有一個帳號，不用輸入任何東西（驗證功能用，最快）
   "email"     = 輸入 Email 收登入連結（正式版用，換手機資料會跟著走；需要多設 Supabase 的 Site URL） */
export const AUTH_MODE = "anonymous";
