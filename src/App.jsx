import { useState, useEffect, useRef, createContext, useContext } from "react";
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from "@zxing/library";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { AUTH_MODE } from "./config.js";
import { loadPets, upsertPet, deletePet, loadLang, saveLang } from "./lib/db";

/* ------------------------------------------------------------------
   寵物護照 v2 — 手帳風格版（新 artifact，舊版不受影響）

   新增：
   1. 檢查商品：條碼查 Open Pet Food Facts → 拍成分表由 AI 讀 → 手動輸入
      只判斷兩件事：有沒有含過敏原、年齡段對不對
   2. 玩伴建議：依物種／月齡／體型／結紮／活動量給文字建議（附參考來源）
   3. 視覺改為日系手帳／寵物相簿風格

   v2.2：拍條碼改為三層辨識，iPhone 也能用
      ① 瀏覽器內建 BarcodeDetector（Chrome / Android）
      ② ZXing 函式庫（所有瀏覽器含 iOS Safari；artifact 從 CDN 載入，Netlify 版改用 npm 套件）
      ③ AI 讀條碼下方印刷的數字（會做校驗碼檢查，並提示使用者核對）
      都失敗才請使用者手動輸入

   v2.3：表單裡有照片時，可以讓 AI 猜物種與品種（限定回傳 BREEDS 裡的代碼），
      自動選好下拉選單並標示把握程度，使用者可直接改

   v3.0（雲端版）：資料改存 Supabase，需要 Email 登入。
      和 artifact 版的差別只有四處：import、visionRequest、loadZXing、主元件 PetJournal 與 Login。
      其他畫面與邏輯完全相同。

   v2.4：移除晶片號碼與疫苗到期提醒（欄位、首頁便利貼、詳細頁貼紙）。
      多筆健康紀錄（含疫苗）之後以獨立功能加回。

   v2.5：體重改成拉桿（依物種給範圍）＋ −／＋ 微調 0.1 公斤，可清除。

   v2.5.1：首頁標題橫幅擺正（順便修掉 .pp-label 與表單標籤同名互相覆蓋的問題）。

   v2.6：商品檢查的手動輸入改成「常見成分點選（多選）＋自由文字補充」，兩者合併後比對。

   v2.7：新增「所在城市」欄位（下拉選單，存代碼，顯示時翻譯；資料庫加 city 欄）。

   v2.7.1：所有方框、卡片、貼紙、紙膠帶全部擺正，不再有任何旋轉。

   資料存放：Supabase（見 src/lib/db.js、supabase/schema.sql）；語言偏好存 localStorage
------------------------------------------------------------------ */

const CSS = `
.pp{
  --paper:#D8C6A2;
  --card:#FBF6EA;
  --ink:#3B3024;
  --ink-soft:#7B6C57;
  --rule:#E6DAC2;
  --tape-a:#8DB7A6;
  --tape-b:#E4AFA7;
  --tape-c:#E5C15E;
  --berry:#9E3D57;
  --ok:#5F8A5B;
  --font-round:ui-rounded,"Hiragino Maru Gothic ProN","Yu Gothic UI","Arial Rounded MT Bold","Noto Sans TC",sans-serif;
  --font-type:"Courier New",Courier,monospace;

  font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;
  color:var(--ink);
  background-color:var(--paper);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.pp *{box-sizing:border-box;}
.pp button{font-family:inherit;cursor:pointer;}
.pp :focus-visible{outline:2px solid var(--berry);outline-offset:2px;}

/* ---- 紙膠帶 ---- */
.tape{
  position:absolute;top:-9px;left:18px;width:72px;height:20px;
  background-color:var(--tape-a);opacity:.92;
  background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0) 0 5px,rgba(255,255,255,.38) 5px 7px);
  border-radius:1px;box-shadow:0 1px 2px rgba(59,48,36,.12);pointer-events:none;
}
.tape.b{background-color:var(--tape-b);left:auto;right:22px;}
.tape.c{background-color:var(--tape-c);}

/* ---- 紙卡 ---- */
.paper{
  position:relative;background:var(--card);border-radius:3px;
  box-shadow:0 2px 6px rgba(59,48,36,.16);
}

/* ---- 頁首：牛皮筆記本封面 + 貼紙標籤 ---- */
.pp-top{padding:30px 20px 22px;position:relative;}
.pp-banner{
  display:inline-block;background:var(--card);padding:12px 18px 10px;
  box-shadow:0 2px 6px rgba(59,48,36,.2);
  position:relative;border-radius:2px;
}
.pp-banner .tape{left:50%;margin-left:-36px;top:-10px;}
.pp-title{font-family:var(--font-round);font-size:24px;margin:0;font-weight:700;letter-spacing:.02em;}
.pp-sub{font-family:var(--font-type);font-size:10px;letter-spacing:.24em;color:var(--ink-soft);margin-top:4px;}
.pp-count{margin-top:18px;font-family:var(--font-type);font-size:11px;letter-spacing:.12em;color:var(--ink-soft);}
.pp-paw{position:absolute;right:18px;top:24px;}
.pp-top .pp-lang{position:absolute;right:16px;bottom:20px;}
.pp-link{background:none;border:none;color:var(--ink-soft);font-size:11px;padding:0;margin-top:6px;
  font-family:var(--font-type);letter-spacing:.08em;text-decoration:underline;text-underline-offset:3px;}
.pp-notice{padding:60px 24px;text-align:center;color:var(--ink-soft);font-size:14px;line-height:1.9;}

/* ---- 語言切換：貼紙 ---- */
.pp-lang{
  display:inline-flex;background:#fff;border-radius:999px;padding:2px;
  box-shadow:0 1px 3px rgba(59,48,36,.2);
}
.pp-lang button{
  background:transparent;border:none;color:var(--ink-soft);
  font-family:var(--font-round);font-size:11px;padding:4px 10px;border-radius:999px;
}
.pp-lang button[data-on="1"]{background:var(--ink);color:#FBF6EA;}

/* ---- 便利貼提醒 ---- */
.pp-alert{
  margin:16px 16px 0;background:#FCEFC3;padding:12px 14px;border-radius:2px;
  box-shadow:0 2px 4px rgba(59,48,36,.16);
  font-size:13px;color:var(--ink);line-height:1.65;
}
.pp-alert b{font-weight:700;}
.pp-alert.warn{background:#F4DADF;}

.pp-body{padding:20px 16px 110px;}

/* ---- 相簿卡片 ---- */
.pp-card{
  position:relative;width:100%;text-align:left;padding:0;display:block;
  background:var(--card);border:none;border-radius:3px;
  box-shadow:0 2px 6px rgba(59,48,36,.16);margin:0 0 20px;
}
.pp-card-in{display:flex;gap:16px;padding:18px 16px 12px;}

/* ---- 相片 + 相角 ---- */
.pp-photo-wrap{position:relative;flex:0 0 auto;}
.pp-photo{
  width:78px;height:96px;display:flex;align-items:center;justify-content:center;
  border:4px solid #fff;box-shadow:0 1px 4px rgba(59,48,36,.22);
  background:#EFE7D6;object-fit:cover;color:#B9AB93;
}
.pp-photo.big{width:104px;height:128px;}
.pp-photo svg{padding:6px;}
img.pp-photo{display:block;}
.pp-corner{position:absolute;width:14px;height:14px;background:var(--ink);opacity:.72;}
.pp-corner.tl{top:-3px;left:-3px;clip-path:polygon(0 0,100% 0,0 100%);}
.pp-corner.tr{top:-3px;right:-3px;clip-path:polygon(0 0,100% 0,100% 100%);}
.pp-corner.bl{bottom:-3px;left:-3px;clip-path:polygon(0 0,0 100%,100% 100%);}
.pp-corner.br{bottom:-3px;right:-3px;clip-path:polygon(100% 0,100% 100%,0 100%);}

.pp-name{font-family:var(--font-round);font-size:20px;font-weight:700;margin:4px 0 0;}
.pp-meta{font-size:12.5px;color:var(--ink-soft);margin-top:6px;line-height:1.7;}
.pp-type{
  font-family:var(--font-type);font-size:10.5px;letter-spacing:.12em;color:var(--ink-soft);
  padding:8px 16px 10px;border-top:1px dotted var(--rule);
}

/* ---- 空狀態 ---- */
.pp-empty{text-align:center;padding:54px 24px;}
.pp-empty p{color:var(--ink-soft);font-size:14px;line-height:1.9;margin:0 0 22px;}

/* ---- 按鈕 ---- */
.pp-btn{
  background:var(--ink);color:#FBF6EA;border:none;
  padding:14px 22px;border-radius:10px;font-size:15px;
  font-family:var(--font-round);width:100%;
}
.pp-btn-ghost{
  background:transparent;color:var(--ink);
  border:1.5px dashed var(--ink-soft);
  padding:13px 22px;border-radius:10px;font-size:14px;width:100%;
}
.pp-btn-danger{
  background:transparent;color:var(--berry);
  border:1.5px dashed var(--berry);
  padding:13px 22px;border-radius:10px;font-size:14px;width:100%;
}
.pp-fab{
  position:fixed;right:18px;bottom:24px;
  width:58px;height:58px;border-radius:50%;
  background:#fff;color:var(--ink);border:none;
  font-size:28px;line-height:1;font-family:var(--font-round);
  box-shadow:0 3px 10px rgba(59,48,36,.3);
  display:flex;align-items:center;justify-content:center;
}

/* ---- 導覽 ---- */
.pp-nav{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 4px;}
.pp-nav > button{background:none;border:none;color:var(--ink);font-size:14px;padding:6px 4px;font-family:var(--font-round);}
.pp-nav > span{font-family:var(--font-type);font-size:11px;letter-spacing:.18em;color:var(--ink-soft);}
.pp-nav-right{display:flex;align-items:center;gap:10px;}
.pp-nav-right > button{background:none;border:none;color:var(--ink);font-size:14px;padding:6px 4px;font-family:var(--font-round);}

/* ---- 詳細頁 ---- */
.pp-page{margin:18px 16px 16px;}
.pp-page-head{display:flex;gap:18px;padding:22px 16px 16px;}
.pp-big-name{font-family:var(--font-round);font-size:26px;font-weight:700;margin:6px 0 0;}
.pp-big-sub{font-size:13px;color:var(--ink-soft);margin-top:6px;line-height:1.8;}
.pp-fields{margin:0;padding:4px 0 2px;}
.pp-row{
  display:flex;justify-content:space-between;gap:16px;
  padding:10px 16px;border-bottom:1px dotted var(--rule);font-size:13.5px;
}
.pp-row:last-child{border-bottom:none;}
.pp-row dt{color:var(--ink-soft);flex:0 0 auto;}
.pp-row dd{margin:0;text-align:right;}

/* ---- 段落卡 ---- */
.pp-annex{margin:0 16px 20px;padding-bottom:6px;}
.pp-annex-h{padding:16px 16px 6px;display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.pp-h{
  font-family:var(--font-round);font-size:15px;font-weight:700;display:inline;
  background:linear-gradient(transparent 62%,rgba(229,193,94,.6) 62%);padding:0 3px;
}
.pp-annex-h em{font-style:normal;font-family:var(--font-type);font-size:9.5px;color:var(--ink-soft);letter-spacing:.18em;}
.pp-advice{padding:11px 16px;border-bottom:1px dotted var(--rule);display:flex;gap:12px;}
.pp-advice:last-of-type{border-bottom:none;}
.pp-advice .k{flex:0 0 62px;font-size:11px;color:var(--ink-soft);padding-top:3px;font-family:var(--font-round);}
.pp-advice .v{font-size:13.5px;line-height:1.8;}
.pp-note{
  padding:12px 16px 10px;border-top:1px dotted var(--rule);margin-top:6px;
  font-size:11.5px;line-height:1.75;color:var(--ink-soft);font-style:italic;
}

/* ---- 推薦商品 ---- */
.pp-prod{padding:14px 16px;border-bottom:1px dotted var(--rule);}
.pp-prod:last-of-type{border-bottom:none;}
.pp-prod-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
.pp-prod-brand{font-size:11px;color:var(--ink-soft);font-family:var(--font-type);letter-spacing:.06em;}
.pp-prod-name{font-family:var(--font-round);font-size:15px;font-weight:700;margin:3px 0 0;line-height:1.4;}
.pp-rank{
  width:30px;height:30px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(59,48,36,.2);border:2px solid var(--tape-c);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-round);font-weight:700;font-size:14px;color:var(--ink);
  flex:0 0 auto;
}
.pp-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.pp-tag{
  font-size:10.5px;padding:3px 9px;border-radius:999px;background:#fff;
  box-shadow:0 1px 2px rgba(59,48,36,.14);color:var(--ink-soft);
}
.pp-prod-ing{font-size:11.5px;color:var(--ink-soft);margin-top:8px;line-height:1.7;}
.pp-why-h{font-size:11.5px;color:var(--ink-soft);margin-top:11px;font-family:var(--font-round);}
.pp-why{margin:5px 0 0;padding:0;list-style:none;}
.pp-why li{font-size:13px;line-height:1.75;padding-left:16px;position:relative;}
.pp-why li::before{content:"";position:absolute;left:2px;top:9px;width:7px;height:7px;border-radius:50%;background:var(--ok);}
.pp-why.warn li::before{background:var(--berry);}
.pp-none{padding:12px 16px 14px;font-size:13px;color:var(--ink-soft);line-height:1.8;}


/* ---- 體重拉桿 ---- */
.pp-wt{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.pp-wt-val{font-family:var(--font-round);font-size:28px;font-weight:700;min-width:92px;line-height:1;}
.pp-wt-val[data-empty="1"]{color:#B9AB93;}
.pp-wt-val small{font-size:12px;color:var(--ink-soft);margin-left:5px;font-weight:400;}
.pp-wt-btn{width:42px;height:42px;border-radius:50%;background:#fff;border:1px solid var(--rule);
  font-size:20px;line-height:1;color:var(--ink);box-shadow:0 1px 3px rgba(59,48,36,.14);flex:0 0 auto;}
.pp-wt-clear{margin-left:auto;background:none;border:none;color:var(--ink-soft);font-size:11px;
  font-family:var(--font-type);letter-spacing:.08em;text-decoration:underline;text-underline-offset:3px;padding:6px 0;}
.pp-range{-webkit-appearance:none;appearance:none;width:100%;height:36px;background:transparent;margin:0;display:block;}
.pp-range::-webkit-slider-runnable-track{height:4px;background:var(--rule);border-radius:2px;}
.pp-range::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;border-radius:50%;background:#fff;
  border:3px solid var(--ink);margin-top:-13px;box-shadow:0 2px 5px rgba(59,48,36,.25);}
.pp-range::-moz-range-track{height:4px;background:var(--rule);border-radius:2px;}
.pp-range::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#fff;border:3px solid var(--ink);box-shadow:0 2px 5px rgba(59,48,36,.25);}
.pp-range-scale{display:flex;justify-content:space-between;font-family:var(--font-type);font-size:10px;
  color:var(--ink-soft);letter-spacing:.06em;margin-top:-2px;}

/* ---- 表單 ---- */
.pp-form{padding:12px 16px 40px;}
.pp-field{margin-bottom:18px;}
.pp-label{display:block;font-size:12.5px;color:var(--ink-soft);margin-bottom:7px;font-family:var(--font-round);}
.pp-label i{font-style:normal;color:var(--berry);margin-left:3px;}
.pp-input,.pp-select,.pp-textarea{
  width:100%;padding:12px 12px;font-size:15px;
  border:1px solid var(--rule);border-radius:8px;
  background:#fff;color:var(--ink);font-family:inherit;
}
.pp-textarea{min-height:64px;resize:vertical;}
.pp-select{
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%237B6C57' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 13px center;padding-right:38px;
}
.pp-seg{display:flex;gap:8px;}
.pp-seg button{
  flex:1;padding:12px 6px;font-size:14px;border:1px solid var(--rule);border-radius:8px;
  background:#fff;color:var(--ink-soft);font-family:var(--font-round);
}
.pp-seg button[data-on="1"]{background:var(--ink);color:#FBF6EA;border-color:var(--ink);}
.pp-chips{display:flex;flex-wrap:wrap;gap:8px;}
.pp-chip{
  padding:9px 13px;font-size:13px;border-radius:999px;
  border:1px solid var(--rule);background:#fff;color:var(--ink-soft);font-family:var(--font-round);
}
.pp-chip[data-on="1"]{background:var(--ink);color:#FBF6EA;border-color:var(--ink);}
.pp-hint{font-size:11.5px;color:var(--ink-soft);margin-top:6px;line-height:1.7;}
.pp-photo-pick{display:flex;align-items:center;gap:16px;}
.pp-actions{display:flex;flex-direction:column;gap:10px;margin-top:26px;}
.pp-err{color:var(--berry);font-size:12.5px;margin-top:-8px;margin-bottom:14px;}

/* ---- 檢查商品 ---- */
.pp-tier{margin:0 16px 18px;padding:16px 16px 14px;}
.pp-tier-h{font-family:var(--font-round);font-size:15px;font-weight:700;margin:0 0 4px;}
.pp-tier-d{font-size:12.5px;color:var(--ink-soft);line-height:1.7;margin:0 0 12px;}
.pp-inline{display:flex;gap:8px;}
.pp-inline .pp-input{flex:1;}
.pp-inline .pp-btn{width:auto;padding:12px 16px;font-size:14px;}
.pp-msg{font-size:12.5px;color:var(--berry);margin-top:10px;line-height:1.7;}
.pp-msg.soft{color:var(--ink-soft);}
.pp-src{font-family:var(--font-type);font-size:10.5px;letter-spacing:.06em;color:var(--ink-soft);margin-top:10px;line-height:1.7;}
.pp-verdict{
  display:inline-block;padding:8px 16px;border-radius:999px;background:var(--ok);color:#fff;
  font-family:var(--font-round);font-weight:700;font-size:15px;
  box-shadow:0 2px 4px rgba(59,48,36,.2);margin:6px 16px 4px;
}
.pp-verdict.bad{background:var(--berry);}
.pp-verdict.mid{background:#B08A2E;}
.pp-res{padding:8px 16px 4px;font-size:13.5px;line-height:1.8;}
.pp-res .ok{color:var(--ok);}
.pp-res .bad{color:var(--berry);}
.pp-res .unk{color:#8A6D1D;}
`;

/* ==================================================================
   文字字典
================================================================== */

const STR = {
  zh: {
    title: "寵物手帳",
    sub: "PET PASSPORT",
    loading: "翻開手帳中…",
    auth: {
      title: "登入手帳",
      intro: "輸入 Email，我們寄一個登入連結給你，點了就進來，不用密碼。換手機也只要再登入一次，資料都還在。",
      email: "Email",
      send: "寄登入連結",
      sending: "寄送中…",
      sent: (e) => `已寄到 ${e}。請到信箱點連結（找不到請看垃圾郵件）。`,
      err: "寄送失敗，請確認 Email 再試一次。",
      privacy: "你的寵物資料只有你登入後看得到。",
      logout: "登出",
      notConfigured: "還沒填資料庫連線。請打開 src/config.js 貼上 Supabase 的 URL 和 anon key，再重新上傳。",
      anonFail: "自動登入失敗。請到 Supabase 後台 Authentication → Sign In / Providers，打開「Allow anonymous sign-ins」。",
      guest: "訪客帳號 · 資料已存在雲端",
      loadFail: "讀取資料失敗，請重新整理再試。",
    },
    issued: (n) => `${n} 位家庭成員`,
    notIssued: "還沒有家庭成員",
    storageWarn: "資料暫時無法儲存，這次的修改在重新整理後可能會消失。",
    empty1: "這本手帳還是空的。",
    empty2: "先把牠貼上來吧。",
    createFirst: "新增第一位成員",
    addPet: "新增寵物",
    weightUnknown: "體重未填",
    kg: (w) => `${w} 公斤`,
    neuteredTag: "已結紮",
    back: "← 返回",
    edit: "編輯",
    cancelNav: "← 取消",
    join: "、",
    est: "SINCE",
    speciesName: { dog: "犬", cat: "貓" },
    rows: {
      species: "物種", gender: "性別", birthday: "生日", weight: "體重", neutered: "結紮",
      allergies: "過敏原", city: "所在城市", note: "備註",
    },
    gender: { male: "公", female: "母" },
    neuteredYes: "已結紮",
    neuteredNo: "未結紮",
    noAllergy: "無",
    annex1: "營養方向",
    annex2: "推薦商品",
    annex3: "玩伴建議",
    checkBtn: "檢查一款商品適不適合牠",
    noProducts: "目前的目錄裡沒有能避開所有過敏原、又符合年齡階段的商品。建議直接諮詢獸醫，或考慮處方飼料。",
    ingredientsLabel: "主要成分：",
    whyFor: (n) => `為什麼適合 ${n}`,
    watchOut: "要留意",
    disclaimer: "商品為範例資料，用來示範推薦邏輯，正式版會串接真實資料庫。所有建議依基本資料自動產生，僅供參考，不能取代獸醫的專業診斷。",
    deleteBtn: "移除這位成員",
    deleteConfirm: (n) => `刪除後無法復原。確定要移除 ${n} 嗎？`,
    deleteYes: "確定移除",
    cancel: "取消",
    age: (y, m) => (y === 0 ? `${m} 個月` : m === 0 ? `${y} 歲` : `${y} 歲 ${m} 個月`),
    stage: { young: { dog: "幼犬", cat: "幼貓" }, adult: { dog: "成犬", cat: "成貓" }, senior: { dog: "熟齡犬", cat: "熟齡貓" } },
    advice: {
      age: "年齡", neutered: "結紮", allergies: "過敏原",
      young: (s) => `建議選擇${s}專用飼料，此階段的蛋白質與熱量需求較高。`,
      adult: (s) => `建議選擇${s}維持期飼料，維持穩定的體態即可。`,
      senior: "已進入熟齡階段，建議選擇熟齡專用配方，並留意關節與腎臟保健。",
      neuteredV: "結紮後代謝率下降約 20%，建議改用低脂或體重管理配方。",
      allergyV: (list) => `請避開含有 ${list} 的成分，可考慮單一蛋白質來源配方。`,
    },
    reasons: {
      stageExact: (s) => `專為${s}設計，符合這個階段的蛋白質與熱量比例。`,
      stageAll: "全齡配方，各年齡階段都能食用。",
      noAllergen: (list) => `成分表不含你標記的 ${list}。`,
      single: (p) => `單一蛋白質來源（${p}），有過敏史的寵物比較不容易踩雷。`,
      neuteredWeight: "已結紮後代謝變慢，這款是低熱量的體重管理配方。",
      neuteredWarn: "不是體重管理配方，已結紮請依包裝建議量的下限餵食。",
      seniorJoint: "添加葡萄糖胺，照顧熟齡階段的關節。",
      seniorWarn: "未添加關節保健成分。",
      small: (w) => `${w} 公斤屬於小型犬，這款顆粒較小、方便咀嚼。`,
      large: (w) => `${w} 公斤屬於大型犬，這款控制了鈣磷比例，減輕骨骼負擔。`,
    },
    tags: { weight: "體重管理", highProtein: "高蛋白", single: "單一蛋白", joint: "關節保健", small: "小型犬", large: "大型犬", grainFree: "無穀" },
    playmate: {
      k: { age: "年齡", size: "體型", status: "狀態", nature: "天性" },
      dogUnder4m: "未滿 4 個月，疫苗還沒打完，不建議去狗公園或接觸陌生犬。但社會化黃金期是 3–14 週，可以在家中或熟人家裡，與已完整接種、性格穩定的成犬短暫互動。",
      dogPuppy: "4 個月到 1 歲是精力最旺盛的階段，適合和同齡幼犬或有耐心的溫和成犬玩。每次 15–20 分鐘，累了就停。",
      dogAdult: "成犬適合和活動量、體型相近的犬隻玩。初次見面先繫繩，在中立場所（不是任一方的家）進行。",
      dogSenior: "熟齡犬適合和性格穩定的成犬或同齡犬做短時間、低強度的互動，例如一起散步。避開精力旺盛的幼犬，撲跳容易造成關節負擔。",
      dogSmall: "10 公斤以下屬小型犬。建議和體型相近的犬隻玩，避免和大型犬玩追逐遊戲——體型差距太大時，追逐可能觸發大型犬的捕獵本能。多數狗公園因此設有小型犬區。",
      dogMedium: "10–25 公斤屬中型犬，和大多數體型的犬隻都能相處。和小型犬互動時，留意動作不要太粗魯。",
      dogLarge: "25 公斤以上屬大型犬。和同體型或中型犬玩最合適；和小型犬互動時避免追逐與撲壓，改用並排散步。",
      dogIntactMale: "未結紮公犬與其他未結紮公犬之間，衝突機率較高。初次見面請繫繩，並觀察僵硬、低吼等訊號。",
      catGeneral: "貓是領域性動物，多數動物行為機構不建議帶貓參加聚會或與陌生貓互動——這對貓來說是壓力而非樂趣。牠最好的玩伴是你（每天兩次、每次 10–15 分鐘的逗貓棒），以及同住的貓。",
      catKitten: "1 歲以下的幼貓接受新貓的能力最強。如果考慮第二隻貓，這是最好的時機，但仍需分房隔離、循序漸進介紹，通常需要一到數週。",
      catAdult: "成貓要引入新貓，需要更長的分房介紹期（數週到數月），且性格是否相配比年齡更重要。",
      catSenior: "熟齡貓通常偏好安靜穩定的環境，引入活潑幼貓容易造成長期壓力。若有需要，選擇性格溫和的成貓，並確保牠有可以躲避的專屬空間。",
      sources: "參考：AVSAB《幼犬社會化立場聲明》、ASPCA 狗公園安全建議、International Cat Care 多貓家庭指引。以上為一般性建議，實際互動請以現場觀察為準。",
    },
    check: {
      nav: "CHECK",
      title: (n) => `幫 ${n} 檢查一款商品`,
      criteria: "只看兩件事：成分有沒有含牠的過敏原、商品的年齡段對不對。其他營養判斷請交給獸醫。",
      petLine: (stage, allergies) => `牠現在是${stage}，過敏原：${allergies}`,
      tier1: "① 輸入條碼",
      tier1d: "輸入包裝上的條碼數字（通常 13 碼），查詢 Open Pet Food Facts。",
      barcodePh: "4712345678901",
      lookup: "查詢",
      scan: "拍條碼",
      scanning: "辨識條碼中…",
      scanAI: "條碼不清楚，改由 AI 讀數字…",
      scanFail: "照片裡讀不到條碼，請手動輸入數字。拍的時候讓條碼佔滿畫面、對焦清楚、避免反光。",
      scanByAI: "這串數字是 AI 從照片上讀的，請和包裝核對。",
      scanHint: "手機拍下包裝上的條碼即可，iPhone 與 Android 都支援。",
      searching: "查詢中…",
      notFound: "資料庫裡沒有這個條碼。請改用下面的方式。",
      netError: "無法連線到資料庫（預覽環境可能限制對外連線，正式版不會）。請改用下面的方式。",
      opffNote: "資料來源：Open Pet Food Facts（開源社群資料庫）。目前僅比對此資料庫，收錄量有限，亞洲市場商品常查不到。",
      tier2: "② 拍成分表",
      tier2d: "查不到時，拍下包裝上的成分表，由 AI 讀出文字。",
      takeLabel: "拍成分表",
      pickLabel: "從相簿選擇",
      reading: "AI 讀取中…",
      aiFail: "讀取失敗，請改用手動輸入。",
      tier3: "③ 手動輸入",
      tier3d: "直接抄下包裝上的成分表。",
      manualStart: "開始手動輸入",
      productTitle: "商品資訊",
      nameLabel: "商品名稱",
      ingLabel: "成分（可修改）",
      pickIng: "常見成分（點選，可多選）",
      extraIng: "其他成分（選單裡沒有的，直接抄包裝）",
      pickedPreview: (t) => `會用來比對的成分：${t}`,
      ingPh: "chicken, brown rice, …",
      stageLabel: "商品適用年齡段",
      stages: { young: "幼年", adult: "成年", senior: "熟齡", all: "全齡", unknown: "不確定" },
      sourceLabel: "來源：",
      sources: { opff: "Open Pet Food Facts", ai: "AI 讀取照片（請核對）", manual: "手動輸入" },
      clear: "清除重來",
      resultTitle: "判斷結果",
      verdict: { bad: "不建議", ok: "可以考慮", stageMismatch: "年齡段不符", stageUnknown: "過敏原沒問題，年齡段不確定" },
      allergenHit: (list) => `含有牠的過敏原：${list}`,
      allergenNone: "沒有發現牠的過敏原",
      petNoAllergy: "牠沒有登記過敏原，所以第一項無法比對。想比對請先在資料裡填上。",
      stageOk: (p) => `年齡段相符（${p}）`,
      stageAll: "全齡配方，年齡段沒問題",
      stageBad: (prod, pet) => `年齡段不符：商品是${prod}用，牠是${pet}`,
      stageUnk: "無法從資料判斷年齡段，請看包裝確認",
      resultNote: "此判斷只依據上述兩個條件，不代表營養上完全合適。慢性病、處方需求請諮詢獸醫。",
    },
    form: {
      newLabel: "NEW", editLabel: "EDIT",
      photo: "照片", takePhoto: "拍照", fromGallery: "從相簿選擇",
      photoHint: "在手機上「拍照」會直接開啟相機；在電腦上會開啟檔案選擇視窗。",
      name: "名字", namePh: "小白",
      species: "物種", dog: "犬", cat: "貓",
      breed: "品種", pick: "請選擇", breedOtherPh: "請輸入品種",
      gender: "性別", male: "公", female: "母",
      birthday: "生日", birthdayHint: "不確定的話填領養日期就好，之後可以改。",
      weight: "體重（公斤）", weightHint: "拉到大概的位置，再用 −／＋ 微調。不清楚可以先不填。", weightClear: "清除",
      neutered: "結紮狀態", yes: "已結紮", no: "未結紮",
      allergies: "已知過敏原",
      allergiesHint: "點選所有已知的過敏原，沒有就不用選。",
      city: "所在城市", cityHint: "之後找玩伴、揪團、附近診所都會用到。",
      note: "備註", notePh: "怕打雷、不能吃太快",
      errName: "請填寫名字。",
      errBirthday: "請填寫生日，年齡與飼料建議需要用到。",
      errFuture: "生日不能是未來的日期。",
      errPhoto: "這張圖片讀不進來，換一張試試。",
      guess: "讓 AI 猜物種與品種",
      guessing: "AI 辨識中…",
      guessDone: (sp, br, conf) => `AI 猜是${sp}${br ? `・${br}` : ""}（把握${conf}）。已幫你選好，不對請直接改。`,
      guessNone: "AI 看不出照片裡是狗還是貓，請自己選。",
      guessFail: "辨識失敗，請自己選。",
      guessHint: "只是幫你先選。米克斯和幼獸常會猜錯，請以你知道的為準。",
      conf: { high: "高", medium: "中", low: "低" },
      save: "儲存修改", issue: "貼進手帳", cancel: "取消",
    },
  },

  en: {
    title: "Pet Journal",
    sub: "寵物手帳",
    loading: "Opening the journal…",
    auth: {
      title: "Sign in",
      intro: "Enter your email and we'll send you a sign-in link. No password. On a new phone, just sign in again and everything is there.",
      email: "Email",
      send: "Send sign-in link",
      sending: "Sending…",
      sent: (e) => `Sent to ${e}. Open the link in that email (check spam if it's missing).`,
      err: "Couldn't send. Check the email address and try again.",
      privacy: "Your pets are only visible to you after signing in.",
      logout: "Sign out",
      notConfigured: "Database connection isn't set. Open src/config.js, paste your Supabase URL and anon key, and upload again.",
      anonFail: "Automatic sign-in failed. In Supabase go to Authentication → Sign In / Providers and enable \"Allow anonymous sign-ins\".",
      guest: "Guest account · saved in the cloud",
      loadFail: "Couldn't load your data. Please refresh and try again.",
    },
    issued: (n) => `${n} family member${n === 1 ? "" : "s"}`,
    notIssued: "No family members yet",
    storageWarn: "Data can't be saved right now. Changes may be lost after a refresh.",
    empty1: "This journal is still empty.",
    empty2: "Add your first family member.",
    createFirst: "Add first member",
    addPet: "Add pet",
    weightUnknown: "Weight not set",
    kg: (w) => `${w} kg`,
    neuteredTag: "Neutered",
    back: "← Back",
    edit: "Edit",
    cancelNav: "← Cancel",
    join: ", ",
    est: "SINCE",
    speciesName: { dog: "Dog", cat: "Cat" },
    rows: {
      species: "Species", gender: "Sex", birthday: "Date of birth", weight: "Weight", neutered: "Neutered",
      allergies: "Allergies", city: "City", note: "Notes",
    },
    gender: { male: "Male", female: "Female" },
    neuteredYes: "Yes",
    neuteredNo: "No",
    noAllergy: "None",
    annex1: "Nutrition profile",
    annex2: "Recommended products",
    annex3: "Playmate guide",
    checkBtn: "Check if a product suits them",
    noProducts: "Nothing in the current catalogue avoids all listed allergens and fits this life stage. Talk to your vet or consider a prescription diet.",
    ingredientsLabel: "Main ingredients: ",
    whyFor: (n) => `Why it suits ${n}`,
    watchOut: "Keep in mind",
    disclaimer: "Products are sample data to demonstrate the recommendation logic; the release version will connect to a real database. All suggestions are generated automatically and are not a substitute for veterinary advice.",
    deleteBtn: "Remove this member",
    deleteConfirm: (n) => `This can't be undone. Remove ${n}?`,
    deleteYes: "Remove",
    cancel: "Cancel",
    age: (y, m) => (y === 0 ? `${m} mo` : m === 0 ? `${y} yr${y === 1 ? "" : "s"}` : `${y} yr ${m} mo`),
    stage: { young: { dog: "puppies", cat: "kittens" }, adult: { dog: "adult dogs", cat: "adult cats" }, senior: { dog: "senior dogs", cat: "senior cats" } },
    advice: {
      age: "Age", neutered: "Neutered", allergies: "Allergies",
      young: (s) => `Choose a formula made for ${s}; protein and calorie needs are higher at this stage.`,
      adult: (s) => `Choose a maintenance formula for ${s} to keep a stable body condition.`,
      senior: "Now in the senior stage. Choose a senior formula and keep an eye on joint and kidney health.",
      neuteredV: "Metabolism drops around 20% after neutering. Consider a low-fat or weight-control formula.",
      allergyV: (list) => `Avoid anything containing ${list}. A single-protein formula is a safer starting point.`,
    },
    reasons: {
      stageExact: (s) => `Made for ${s}, with protein and calories matched to this stage.`,
      stageAll: "All-life-stage formula, suitable at any age.",
      noAllergen: (list) => `The ingredient list doesn't include ${list}.`,
      single: (p) => `Single protein source (${p}), which is less risky for pets with allergies.`,
      neuteredWeight: "Neutered pets burn fewer calories; this is a lower-calorie weight-control formula.",
      neuteredWarn: "Not a weight-control formula. Since your pet is neutered, feed at the lower end of the pack guidance.",
      seniorJoint: "Contains glucosamine to support senior joints.",
      seniorWarn: "No joint-support ingredients included.",
      small: (w) => `At ${w} kg this is a small breed; this kibble is smaller and easier to chew.`,
      large: (w) => `At ${w} kg this is a large breed; this formula controls calcium and phosphorus to ease bone load.`,
    },
    tags: { weight: "Weight control", highProtein: "High protein", single: "Single protein", joint: "Joint care", small: "Small breed", large: "Large breed", grainFree: "Grain-free" },
    playmate: {
      k: { age: "Age", size: "Size", status: "Status", nature: "Nature" },
      dogUnder4m: "Under 4 months and not fully vaccinated, so dog parks and unfamiliar dogs are not recommended. The socialisation window is 3–14 weeks though, so short, supervised time with a fully vaccinated, steady adult dog at home or a friend's place is valuable.",
      dogPuppy: "4 months to 1 year is peak energy. Good matches are puppies of a similar age or patient, gentle adult dogs. Keep sessions to 15–20 minutes and stop when tired.",
      dogAdult: "Adult dogs do best with playmates of similar energy and size. For a first meeting, keep both on lead and use neutral ground rather than either dog's home.",
      dogSenior: "Senior dogs suit short, low-intensity time with calm adults or other seniors, such as a shared walk. Avoid bouncy puppies; the jumping is hard on joints.",
      dogSmall: "Under 10 kg counts as a small breed. Play with similar-sized dogs and avoid chase games with large dogs; a big size gap can trigger a large dog's prey drive. This is why most dog parks have a small-dog area.",
      dogMedium: "10–25 kg is a medium breed and gets on with most sizes. With smaller dogs, keep an eye on rough play.",
      dogLarge: "Over 25 kg is a large breed. Same-size or medium dogs are the best match; with small dogs, skip chasing and pouncing in favour of a side-by-side walk.",
      dogIntactMale: "Intact males have a higher chance of conflict with other intact males. Keep the first meeting on lead and watch for stiffening or low growls.",
      catGeneral: "Cats are territorial, and most animal-behaviour organisations advise against cat meet-ups or contact with unfamiliar cats; it's stress, not fun, for them. Their best playmates are you (two 10–15 minute wand-toy sessions a day) and any cat they already live with.",
      catKitten: "Kittens under 1 year are the most accepting of a new cat. If a second cat is on your mind, this is the best time, but it still needs a separate room and a gradual introduction over one to several weeks.",
      catAdult: "Introducing a new cat to an adult needs a longer separate-room period (weeks to months), and personality fit matters more than age.",
      catSenior: "Senior cats usually prefer a quiet, stable home; a lively kitten can cause long-term stress. If needed, choose a gentle adult cat and make sure the senior has a private space to retreat to.",
      sources: "Based on: AVSAB Position Statement on Puppy Socialization, ASPCA dog park guidance, International Cat Care multi-cat household guidance. General advice only; always go by what you observe in the moment.",
    },
    check: {
      nav: "CHECK",
      title: (n) => `Check a product for ${n}`,
      criteria: "Only two things are checked: whether the ingredients contain their allergens, and whether the life stage matches. Leave the rest of the nutrition call to your vet.",
      petLine: (stage, allergies) => `They are ${stage}. Allergies: ${allergies}`,
      tier1: "① Enter barcode",
      tier1d: "Type the barcode number on the pack (usually 13 digits) to look it up in Open Pet Food Facts.",
      barcodePh: "4712345678901",
      lookup: "Look up",
      scan: "Photo of barcode",
      scanning: "Reading barcode…",
      scanAI: "Barcode unclear, asking AI to read the digits…",
      scanFail: "No barcode found in that photo. Please type the number. Fill the frame with the barcode, keep it in focus and avoid glare.",
      scanByAI: "AI read these digits from the photo. Please check them against the pack.",
      scanHint: "Just photograph the barcode on the pack. Works on iPhone and Android.",
      searching: "Looking up…",
      notFound: "That barcode isn't in the database. Try one of the options below.",
      netError: "Couldn't reach the database (the preview environment may block outside connections; the release version won't). Try one of the options below.",
      opffNote: "Source: Open Pet Food Facts (open, community-maintained). This is currently the only database checked; coverage is limited, especially for Asian markets.",
      tier2: "② Photo of the label",
      tier2d: "If the lookup fails, photograph the ingredient list and let AI read it.",
      takeLabel: "Take photo of label",
      pickLabel: "Choose from library",
      reading: "AI is reading…",
      aiFail: "Couldn't read that. Please enter it manually.",
      tier3: "③ Enter manually",
      tier3d: "Copy the ingredient list from the pack.",
      manualStart: "Start manual entry",
      productTitle: "Product",
      nameLabel: "Product name",
      ingLabel: "Ingredients (editable)",
      pickIng: "Common ingredients (tap all that apply)",
      extraIng: "Other ingredients (anything not listed; copy from the pack)",
      pickedPreview: (t) => `Ingredients used for the check: ${t}`,
      ingPh: "chicken, brown rice, …",
      stageLabel: "Life stage on the pack",
      stages: { young: "Puppy / kitten", adult: "Adult", senior: "Senior", all: "All life stages", unknown: "Not sure" },
      sourceLabel: "Source: ",
      sources: { opff: "Open Pet Food Facts", ai: "AI read from photo (please verify)", manual: "Entered manually" },
      clear: "Start over",
      resultTitle: "Result",
      verdict: { bad: "Not recommended", ok: "Worth considering", stageMismatch: "Life stage mismatch", stageUnknown: "Allergens OK, life stage unclear" },
      allergenHit: (list) => `Contains their allergens: ${list}`,
      allergenNone: "None of their allergens found",
      petNoAllergy: "No allergies are recorded for them, so the first check can't run. Add allergies to their profile to enable it.",
      stageOk: (p) => `Life stage matches (${p})`,
      stageAll: "All-life-stage formula, so the stage is fine",
      stageBad: (prod, pet) => `Life stage mismatch: the pack is for ${prod}, they are ${pet}`,
      stageUnk: "Couldn't determine the life stage from the data; check the pack",
      resultNote: "This result is based only on the two checks above and doesn't mean the product is nutritionally right. For chronic conditions or prescription needs, ask your vet.",
    },
    form: {
      newLabel: "NEW", editLabel: "EDIT",
      photo: "Photo", takePhoto: "Take photo", fromGallery: "Choose from library",
      photoHint: "On a phone, \"Take photo\" opens the camera. On a computer it opens the file picker.",
      name: "Name", namePh: "Mochi",
      species: "Species", dog: "Dog", cat: "Cat",
      breed: "Breed", pick: "Select", breedOtherPh: "Enter breed",
      gender: "Sex", male: "Male", female: "Female",
      birthday: "Date of birth", birthdayHint: "Not sure? Use the adoption date. You can change it later.",
      weight: "Weight (kg)", weightHint: "Drag to roughly the right spot, then fine-tune with − / +. Leave empty if unsure.", weightClear: "Clear",
      neutered: "Neutered", yes: "Yes", no: "No",
      allergies: "Known allergies",
      allergiesHint: "Tap every known allergen. Leave empty if none.",
      city: "City", cityHint: "Used later for playmates, meet-ups and nearby clinics.",
      note: "Notes", notePh: "Scared of thunder, eats too fast",
      errName: "Please enter a name.",
      errBirthday: "Please enter a date of birth. Age and food advice depend on it.",
      errFuture: "Date of birth can't be in the future.",
      errPhoto: "That image couldn't be read. Try another one.",
      guess: "Let AI guess the species and breed",
      guessing: "AI is looking…",
      guessDone: (sp, br, conf) => `AI thinks this is a ${sp}${br ? ` (${br})` : ""}, ${conf} confidence. Selected for you; change it if it's wrong.`,
      guessNone: "AI couldn't tell whether this is a dog or a cat. Please choose.",
      guessFail: "Couldn't recognise the photo. Please choose.",
      guessHint: "This only pre-selects. Mixed breeds and young animals are often misjudged; go with what you know.",
      conf: { high: "high", medium: "medium", low: "low" },
      save: "Save changes", issue: "Add to journal", cancel: "Cancel",
    },
  },
};

const LangCtx = createContext({ lang: "en", L: STR.en, setLang: () => {} });
const useL = () => useContext(LangCtx);

/* ==================================================================
   資料字典
================================================================== */

const BREEDS = {
  dog: {
    mix: ["米克斯", "Mixed breed"], shiba: ["柴犬", "Shiba Inu"], poodle: ["貴賓犬", "Poodle"],
    corgi: ["柯基", "Corgi"], frenchie: ["法國鬥牛犬", "French Bulldog"], pom: ["博美", "Pomeranian"],
    maltese: ["馬爾濟斯", "Maltese"], chihuahua: ["吉娃娃", "Chihuahua"], dachshund: ["臘腸犬", "Dachshund"],
    shihtzu: ["西施犬", "Shih Tzu"], yorkie: ["約克夏", "Yorkshire Terrier"], schnauzer: ["雪納瑞", "Schnauzer"],
    bichon: ["比熊", "Bichon Frise"], husky: ["哈士奇", "Siberian Husky"], golden: ["黃金獵犬", "Golden Retriever"],
    lab: ["拉布拉多", "Labrador Retriever"], border: ["邊境牧羊犬", "Border Collie"], gsd: ["德國牧羊犬", "German Shepherd"],
    akita: ["秋田犬", "Akita"], samoyed: ["薩摩耶", "Samoyed"], taiwan: ["台灣犬", "Taiwan Dog"],
    other: ["其他", "Other"],
  },
  cat: {
    mix: ["米克斯", "Mixed breed"], ash: ["美國短毛貓", "American Shorthair"], bsh: ["英國短毛貓", "British Shorthair"],
    ragdoll: ["布偶貓", "Ragdoll"], persian: ["波斯貓", "Persian"], fold: ["蘇格蘭摺耳貓", "Scottish Fold"],
    munchkin: ["曼赤肯", "Munchkin"], siamese: ["暹羅貓", "Siamese"], bengal: ["孟加拉貓", "Bengal"],
    maine: ["緬因貓", "Maine Coon"], russian: ["俄羅斯藍貓", "Russian Blue"], aby: ["阿比西尼亞貓", "Abyssinian"],
    norwegian: ["挪威森林貓", "Norwegian Forest Cat"], sphynx: ["斯芬克斯", "Sphynx"], exotic: ["異國短毛貓", "Exotic Shorthair"],
    other: ["其他", "Other"],
  },
};

/* 城市：存代碼，顯示時翻譯。順序：新加坡、台灣、亞洲鄰近城市、其他地區 */
const CITIES = {
  singapore: ["新加坡", "Singapore"],
  taipei: ["台北", "Taipei"], newTaipei: ["新北", "New Taipei"], taoyuan: ["桃園", "Taoyuan"],
  taichung: ["台中", "Taichung"], tainan: ["台南", "Tainan"], kaohsiung: ["高雄", "Kaohsiung"],
  hongKong: ["香港", "Hong Kong"], macau: ["澳門", "Macau"],
  kualaLumpur: ["吉隆坡", "Kuala Lumpur"], bangkok: ["曼谷", "Bangkok"], jakarta: ["雅加達", "Jakarta"], manila: ["馬尼拉", "Manila"],
  tokyo: ["東京", "Tokyo"], osaka: ["大阪", "Osaka"], seoul: ["首爾", "Seoul"],
  shanghai: ["上海", "Shanghai"], beijing: ["北京", "Beijing"], shenzhen: ["深圳", "Shenzhen"],
  sydney: ["雪梨", "Sydney"], melbourne: ["墨爾本", "Melbourne"],
  london: ["倫敦", "London"], newYork: ["紐約", "New York"], losAngeles: ["洛杉磯", "Los Angeles"],
  toronto: ["多倫多", "Toronto"], vancouver: ["溫哥華", "Vancouver"],
  other: ["其他", "Other"],
};
const cityLabel = (k, lang) => (CITIES[k] ? CITIES[k][li(lang)] : k || "");

const ING = {
  chicken: ["雞肉", "Chicken"], brownRice: ["糙米", "Brown rice"], oats: ["燕麥", "Oats"],
  chickenFat: ["雞脂", "Chicken fat"], fishOil: ["魚油", "Fish oil"], barley: ["大麥", "Barley"],
  calcium: ["碳酸鈣", "Calcium carbonate"], lamb: ["羊肉", "Lamb"], sweetPotato: ["地瓜", "Sweet potato"],
  peas: ["豌豆", "Peas"], flaxseed: ["亞麻籽", "Flaxseed"], turkey: ["火雞肉", "Turkey"],
  cellulose: ["纖維素", "Cellulose"], peaProtein: ["豌豆蛋白", "Pea protein"], salmon: ["鮭魚", "Salmon"],
  chickpeas: ["鷹嘴豆", "Chickpeas"], lentils: ["扁豆", "Lentils"], duck: ["鴨肉", "Duck"],
  pumpkin: ["南瓜", "Pumpkin"], glucosamine: ["葡萄糖胺", "Glucosamine"], chondroitin: ["軟骨素", "Chondroitin"],
  whitefish: ["白魚", "Whitefish"], chickenLiver: ["雞肝", "Chicken liver"], tuna: ["鮪魚", "Tuna"],
  venison: ["鹿肉", "Venison"], herring: ["鯡魚", "Herring"],
};

/* 沒有照片時的剪影。依「體型類型」分 15 種，不是逐一品種寫實，但同一類型的品種共用一張 */
const SIL = {
  "spitz": "<ellipse cx=\"54\" cy=\"58\" rx=\"27\" ry=\"16\"/><circle cx=\"36\" cy=\"50\" r=\"10\"/><circle cx=\"25\" cy=\"42\" r=\"14\"/><ellipse cx=\"12\" cy=\"47\" rx=\"9\" ry=\"6\"/><polygon points=\"15,33 18,14 27,30\"/><polygon points=\"25,30 31,14 37,32\"/><rect x=\"33\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"44\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"60\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"71\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M78 50 C 94 46, 94 26, 78 28\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"9\" stroke-linecap=\"round\"/>",
  "retriever": "<ellipse cx=\"54\" cy=\"58\" rx=\"28\" ry=\"16\"/><circle cx=\"36\" cy=\"50\" r=\"10\"/><circle cx=\"24\" cy=\"42\" r=\"13\"/><ellipse cx=\"11\" cy=\"47\" rx=\"10\" ry=\"6\"/><ellipse cx=\"31\" cy=\"45\" rx=\"5\" ry=\"11\"/><rect x=\"33\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"44\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"60\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"71\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M80 52 C 92 58, 96 70, 92 82\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"8\" stroke-linecap=\"round\"/>",
  "shepherd": "<ellipse cx=\"54\" cy=\"58\" rx=\"28\" ry=\"15\" transform=\"rotate(8 54 58)\"/><circle cx=\"36\" cy=\"48\" r=\"10\"/><circle cx=\"24\" cy=\"40\" r=\"13\"/><ellipse cx=\"10\" cy=\"46\" rx=\"10\" ry=\"6\"/><polygon points=\"14,30 17,8 27,27\"/><polygon points=\"24,28 32,8 37,30\"/><rect x=\"32\" y=\"64\" width=\"8\" height=\"28\" rx=\"3\"/><rect x=\"43\" y=\"64\" width=\"8\" height=\"28\" rx=\"3\"/><rect x=\"62\" y=\"68\" width=\"8\" height=\"24\" rx=\"3\"/><rect x=\"72\" y=\"68\" width=\"8\" height=\"24\" rx=\"3\"/><path d=\"M80 56 C 88 66, 86 80, 78 88\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"10\" stroke-linecap=\"round\"/>",
  "corgi": "<ellipse cx=\"52\" cy=\"60\" rx=\"34\" ry=\"15\"/><circle cx=\"32\" cy=\"52\" r=\"9\"/><circle cx=\"22\" cy=\"44\" r=\"13\"/><ellipse cx=\"10\" cy=\"49\" rx=\"9\" ry=\"6\"/><ellipse cx=\"16\" cy=\"27\" rx=\"5\" ry=\"11\" transform=\"rotate(-15 16 27)\"/><ellipse cx=\"30\" cy=\"27\" rx=\"5\" ry=\"11\" transform=\"rotate(15 30 27)\"/><rect x=\"26\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"38\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"62\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"74\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/>",
  "dachshund": "<ellipse cx=\"54\" cy=\"62\" rx=\"38\" ry=\"13\"/><circle cx=\"28\" cy=\"56\" r=\"8\"/><circle cx=\"18\" cy=\"48\" r=\"12\"/><ellipse cx=\"6\" cy=\"53\" rx=\"10\" ry=\"5\"/><ellipse cx=\"26\" cy=\"52\" rx=\"5\" ry=\"12\"/><rect x=\"22\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"32\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"72\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><rect x=\"82\" y=\"72\" width=\"8\" height=\"16\" rx=\"3\"/><path d=\"M90 58 C 98 52, 100 42, 96 36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\"/>",
  "frenchie": "<ellipse cx=\"54\" cy=\"60\" rx=\"24\" ry=\"17\"/><circle cx=\"36\" cy=\"52\" r=\"11\"/><circle cx=\"24\" cy=\"42\" r=\"16\"/><ellipse cx=\"12\" cy=\"49\" rx=\"7\" ry=\"6\"/><ellipse cx=\"15\" cy=\"26\" rx=\"7\" ry=\"10\"/><ellipse cx=\"33\" cy=\"26\" rx=\"7\" ry=\"10\"/><rect x=\"34\" y=\"70\" width=\"9\" height=\"22\" rx=\"3\"/><rect x=\"46\" y=\"70\" width=\"9\" height=\"22\" rx=\"3\"/><rect x=\"60\" y=\"70\" width=\"9\" height=\"22\" rx=\"3\"/><rect x=\"70\" y=\"70\" width=\"9\" height=\"22\" rx=\"3\"/>",
  "toy": "<circle cx=\"55\" cy=\"62\" r=\"18\"/><circle cx=\"42\" cy=\"50\" r=\"10\"/><circle cx=\"66\" cy=\"52\" r=\"10\"/><circle cx=\"60\" cy=\"72\" r=\"12\"/><circle cx=\"30\" cy=\"46\" r=\"14\"/><ellipse cx=\"20\" cy=\"32\" rx=\"5\" ry=\"8\"/><ellipse cx=\"38\" cy=\"30\" rx=\"5\" ry=\"8\"/><ellipse cx=\"18\" cy=\"52\" rx=\"7\" ry=\"5\"/><rect x=\"40\" y=\"74\" width=\"7\" height=\"16\" rx=\"3\"/><rect x=\"50\" y=\"74\" width=\"7\" height=\"16\" rx=\"3\"/><rect x=\"60\" y=\"74\" width=\"7\" height=\"16\" rx=\"3\"/><circle cx=\"74\" cy=\"48\" r=\"9\"/>",
  "poodle": "<circle cx=\"26\" cy=\"36\" r=\"14\"/><circle cx=\"26\" cy=\"22\" r=\"9\"/><ellipse cx=\"36\" cy=\"46\" rx=\"7\" ry=\"12\"/><ellipse cx=\"12\" cy=\"42\" rx=\"9\" ry=\"5\"/><ellipse cx=\"54\" cy=\"58\" rx=\"24\" ry=\"13\"/><rect x=\"36\" y=\"66\" width=\"5\" height=\"20\" rx=\"3\"/><rect x=\"46\" y=\"66\" width=\"5\" height=\"20\" rx=\"3\"/><rect x=\"62\" y=\"66\" width=\"5\" height=\"20\" rx=\"3\"/><rect x=\"72\" y=\"66\" width=\"5\" height=\"20\" rx=\"3\"/><circle cx=\"38\" cy=\"88\" r=\"6\"/><circle cx=\"48\" cy=\"88\" r=\"6\"/><circle cx=\"64\" cy=\"88\" r=\"6\"/><circle cx=\"74\" cy=\"88\" r=\"6\"/><path d=\"M78 54 L 86 40\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"88\" cy=\"36\" r=\"7\"/>",
  "schnauzer": "<rect x=\"30\" y=\"46\" width=\"50\" height=\"26\" rx=\"10\"/><rect x=\"26\" y=\"38\" width=\"16\" height=\"18\" rx=\"5\"/><rect x=\"8\" y=\"30\" width=\"28\" height=\"22\" rx=\"6\"/><rect x=\"6\" y=\"50\" width=\"16\" height=\"10\" rx=\"3\"/><polygon points=\"16,32 20,18 26,31\"/><polygon points=\"26,31 32,18 36,32\"/><rect x=\"34\" y=\"70\" width=\"8\" height=\"22\" rx=\"3\"/><rect x=\"44\" y=\"70\" width=\"8\" height=\"22\" rx=\"3\"/><rect x=\"62\" y=\"70\" width=\"8\" height=\"22\" rx=\"3\"/><rect x=\"72\" y=\"70\" width=\"8\" height=\"22\" rx=\"3\"/><rect x=\"80\" y=\"42\" width=\"6\" height=\"10\" rx=\"3\" transform=\"rotate(-20 83.0 47.0)\"/>",
  "mix": "<ellipse cx=\"54\" cy=\"58\" rx=\"27\" ry=\"16\"/><circle cx=\"36\" cy=\"50\" r=\"10\"/><circle cx=\"25\" cy=\"42\" r=\"14\"/><ellipse cx=\"12\" cy=\"47\" rx=\"9\" ry=\"6\"/><polygon points=\"15,33 18,14 27,30\"/><ellipse cx=\"33\" cy=\"34\" rx=\"5\" ry=\"8\" transform=\"rotate(30 33 34)\"/><rect x=\"33\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"44\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"60\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"71\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M80 50 C 92 44, 96 34, 94 26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\"/>",
  "shorthair": "<ellipse cx=\"56\" cy=\"68\" rx=\"22\" ry=\"24\"/><rect x=\"34\" y=\"76\" width=\"44\" height=\"14\" rx=\"6\"/><circle cx=\"30\" cy=\"42\" r=\"14\"/><polygon points=\"18,36 20,20 30,30\"/><polygon points=\"31,29 40,19 43,35\"/><rect x=\"30\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"40\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M76 86 C 92 92, 96 76, 88 70\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\"/>",
  "fluffy": "<ellipse cx=\"56\" cy=\"68\" rx=\"24\" ry=\"24\"/><circle cx=\"38\" cy=\"60\" r=\"12\"/><circle cx=\"74\" cy=\"60\" r=\"12\"/><circle cx=\"56\" cy=\"50\" r=\"14\"/><circle cx=\"34\" cy=\"52\" r=\"12\"/><rect x=\"32\" y=\"76\" width=\"48\" height=\"14\" rx=\"6\"/><circle cx=\"30\" cy=\"42\" r=\"14\"/><polygon points=\"19,36 21,22 30,31\"/><polygon points=\"31,30 39,21 42,36\"/><rect x=\"30\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"40\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M76 86 C 94 92, 100 72, 88 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"14\" stroke-linecap=\"round\"/>",
  "fold": "<ellipse cx=\"56\" cy=\"68\" rx=\"22\" ry=\"24\"/><rect x=\"34\" y=\"76\" width=\"44\" height=\"14\" rx=\"6\"/><circle cx=\"30\" cy=\"42\" r=\"15\"/><circle cx=\"20\" cy=\"31\" r=\"5\"/><circle cx=\"40\" cy=\"30\" r=\"5\"/><rect x=\"30\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><rect x=\"40\" y=\"66\" width=\"8\" height=\"26\" rx=\"3\"/><path d=\"M76 86 C 92 92, 96 76, 88 70\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\"/>",
  "munchkin": "<ellipse cx=\"54\" cy=\"62\" rx=\"26\" ry=\"14\"/><circle cx=\"22\" cy=\"46\" r=\"13\"/><polygon points=\"12,40 14,26 22,35\"/><polygon points=\"26,34 34,25 36,39\"/><rect x=\"32\" y=\"72\" width=\"7\" height=\"14\" rx=\"3\"/><rect x=\"42\" y=\"72\" width=\"7\" height=\"14\" rx=\"3\"/><rect x=\"62\" y=\"72\" width=\"7\" height=\"14\" rx=\"3\"/><rect x=\"72\" y=\"72\" width=\"7\" height=\"14\" rx=\"3\"/><path d=\"M78 56 C 90 50, 94 36, 88 26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\" stroke-linecap=\"round\"/>",
  "sphynx": "<ellipse cx=\"56\" cy=\"68\" rx=\"17\" ry=\"24\"/><rect x=\"39\" y=\"78\" width=\"34\" height=\"12\" rx=\"6\"/><circle cx=\"30\" cy=\"42\" r=\"12\"/><polygon points=\"16,38 18,18 30,31\"/><polygon points=\"30,30 42,18 44,38\"/><rect x=\"32\" y=\"66\" width=\"6\" height=\"26\" rx=\"3\"/><rect x=\"41\" y=\"66\" width=\"6\" height=\"26\" rx=\"3\"/><path d=\"M72 88 C 96 92, 100 66, 86 60\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4\" stroke-linecap=\"round\"/>"
};
const BREED_SIL = {
  dog: { mix: "mix", shiba: "spitz", poodle: "poodle", corgi: "corgi", frenchie: "frenchie", pom: "toy", maltese: "toy",
    chihuahua: "spitz", dachshund: "dachshund", shihtzu: "toy", yorkie: "toy", schnauzer: "schnauzer", bichon: "toy",
    husky: "spitz", golden: "retriever", lab: "retriever", border: "shepherd", gsd: "shepherd", akita: "spitz",
    samoyed: "spitz", taiwan: "mix", other: "mix" },
  cat: { mix: "shorthair", ash: "shorthair", bsh: "shorthair", ragdoll: "fluffy", persian: "fluffy", fold: "fold",
    munchkin: "munchkin", siamese: "shorthair", bengal: "shorthair", maine: "fluffy", russian: "shorthair",
    aby: "shorthair", norwegian: "fluffy", sphynx: "sphynx", exotic: "fold", other: "shorthair" },
};
function silhouetteFor(species, breed) {
  const table = BREED_SIL[species] || BREED_SIL.dog;
  const k = breedKey(species, breed);
  return table[k] || (species === "cat" ? "shorthair" : "mix");
}

const BRANDS = {
  yehara: ["野原", "Yehara"], northfield: ["Northfield", "Northfield"],
  bluecrest: ["Bluecrest", "Bluecrest"], nekono: ["貓野", "Nekono"],
};

const CATALOG = [
  { id: "d01", brand: "yehara", name: ["幼犬 雞肉糙米配方", "Puppy Chicken & Brown Rice"], species: "dog", stage: "young", size: "2 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "oats", "chickenFat", "fishOil"], tags: [] },
  { id: "d02", brand: "yehara", name: ["大型幼犬 骨骼發育配方", "Large Breed Puppy Bone Support"], species: "dog", stage: "young", size: "6 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "barley", "fishOil", "calcium"], tags: ["large"] },
  { id: "d03", brand: "yehara", name: ["小型成犬 小顆粒配方", "Small Breed Adult Mini Kibble"], species: "dog", stage: "adult", size: "1.5 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "oats", "chickenFat"], tags: ["small"] },
  { id: "d04", brand: "yehara", name: ["成犬 羊肉地瓜配方", "Adult Lamb & Sweet Potato"], species: "dog", stage: "adult", size: "2 kg", protein: "lamb", ingredients: ["lamb", "sweetPotato", "peas", "flaxseed"], tags: ["single", "grainFree"] },
  { id: "d05", brand: "northfield", name: ["成犬 體重管理配方", "Adult Weight Control"], species: "dog", stage: "adult", size: "3 kg", protein: "turkey", ingredients: ["turkey", "barley", "cellulose", "peaProtein"], tags: ["weight"] },
  { id: "d06", brand: "bluecrest", name: ["運動犬 高蛋白鮭魚配方", "Active Dog High-Protein Salmon"], species: "dog", stage: "adult", size: "2 kg", protein: "salmon", ingredients: ["salmon", "chicken", "chickpeas", "lentils"], tags: ["highProtein", "grainFree"] },
  { id: "d07", brand: "bluecrest", name: ["全齡犬 鴨肉單一蛋白", "All Life Stages Duck Single Protein"], species: "dog", stage: "all", size: "2 kg", protein: "duck", ingredients: ["duck", "sweetPotato", "peas", "pumpkin"], tags: ["single", "grainFree"] },
  { id: "d08", brand: "northfield", name: ["熟齡犬 關節保健配方", "Senior Joint Care"], species: "dog", stage: "senior", size: "3 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "glucosamine", "chondroitin", "fishOil"], tags: ["joint"] },
  { id: "d09", brand: "northfield", name: ["熟齡犬 低脂白魚配方", "Senior Low-Fat Whitefish"], species: "dog", stage: "senior", size: "2 kg", protein: "whitefish", ingredients: ["whitefish", "brownRice", "cellulose", "glucosamine"], tags: ["weight", "joint", "single"] },
  { id: "c01", brand: "nekono", name: ["幼貓 雞肉配方", "Kitten Chicken"], species: "cat", stage: "young", size: "1.5 kg", protein: "chicken", ingredients: ["chicken", "chickenLiver", "brownRice", "fishOil"], tags: [] },
  { id: "c02", brand: "nekono", name: ["成貓 鮪魚雞肉配方", "Adult Tuna & Chicken"], species: "cat", stage: "adult", size: "2 kg", protein: "tuna", ingredients: ["tuna", "chicken", "brownRice", "fishOil"], tags: [] },
  { id: "c03", brand: "nekono", name: ["結紮貓 體重管理配方", "Neutered Cat Weight Control"], species: "cat", stage: "adult", size: "2 kg", protein: "chicken", ingredients: ["chicken", "barley", "cellulose", "peaProtein"], tags: ["weight"] },
  { id: "c04", brand: "bluecrest", name: ["全齡貓 鹿肉單一蛋白", "All Life Stages Venison Single Protein"], species: "cat", stage: "all", size: "1.5 kg", protein: "venison", ingredients: ["venison", "peas", "sweetPotato", "pumpkin"], tags: ["single", "grainFree"] },
  { id: "c05", brand: "bluecrest", name: ["活力貓 高蛋白鮭魚配方", "Active Cat High-Protein Salmon"], species: "cat", stage: "adult", size: "1.5 kg", protein: "salmon", ingredients: ["salmon", "herring", "chickpeas", "lentils"], tags: ["highProtein", "grainFree"] },
  { id: "c06", brand: "northfield", name: ["熟齡貓 關節腎臟配方", "Senior Joint & Kidney Support"], species: "cat", stage: "senior", size: "2 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "glucosamine", "fishOil"], tags: ["joint"] },
  { id: "c07", brand: "northfield", name: ["熟齡貓 低脂白魚配方", "Senior Low-Fat Whitefish"], species: "cat", stage: "senior", size: "1.5 kg", protein: "whitefish", ingredients: ["whitefish", "brownRice", "cellulose", "glucosamine"], tags: ["weight", "joint", "single"] },
];

/* 過敏原：固定選項。key 存進資料、label 用來顯示、terms 用來比對成分表 */
const ALLERGENS = {
  chicken: { label: ["雞肉", "Chicken"], terms: ["chicken", "雞", "鸡", "poultry"] },
  beef:    { label: ["牛肉", "Beef"],    terms: ["beef", "牛肉"] },
  pork:    { label: ["豬肉", "Pork"],    terms: ["pork", "豬肉", "猪肉", "豬", "猪"] },
  lamb:    { label: ["羊肉", "Lamb"],    terms: ["lamb", "mutton", "羊肉", "羊"] },
  fish:    { label: ["魚類", "Fish"],    terms: ["fish", "魚", "鱼", "salmon", "鮭", "tuna", "鮪", "herring", "鯡", "cod", "鱈", "sardine", "anchovy"] },
  salmon:  { label: ["鮭魚", "Salmon"],  terms: ["salmon", "鮭", "鲑"] },
  tuna:    { label: ["鮪魚", "Tuna"],    terms: ["tuna", "鮪", "金槍魚"] },
  duck:    { label: ["鴨肉", "Duck"],    terms: ["duck", "鴨", "鸭"] },
  turkey:  { label: ["火雞肉", "Turkey"], terms: ["turkey", "火雞", "火鸡"] },
  egg:     { label: ["蛋", "Egg"],       terms: ["egg", "雞蛋", "鸡蛋", "蛋黃", "蛋粉", "全蛋"] },
  dairy:   { label: ["乳製品", "Dairy"], terms: ["dairy", "milk", "cheese", "whey", "lactose", "牛奶", "奶粉", "乳清", "起司", "乳酪"] },
  wheat:   { label: ["小麥", "Wheat"],   terms: ["wheat", "gluten", "小麥", "小麦", "麩質"] },
  corn:    { label: ["玉米", "Corn"],    terms: ["corn", "maize", "玉米"] },
  soy:     { label: ["大豆", "Soy"],     terms: ["soy", "soya", "soybean", "大豆", "黃豆", "黄豆"] },
  rice:    { label: ["米", "Rice"],      terms: ["rice", "大米", "白米", "糙米", "米飯"] },
  peanut:  { label: ["花生", "Peanut"],  terms: ["peanut", "花生"] },
};
const ALLERGEN_KEYS = Object.keys(ALLERGENS);

/* 手動輸入成分時的點選清單：先列 16 個過敏原（比對真正在乎的），再列常見的其他成分 */
const MANUAL_ING = [
  ...ALLERGEN_KEYS.map((k) => ({ key: "a:" + k, label: ALLERGENS[k].label, term: ALLERGENS[k].terms[0] })),
  ...["brownRice", "oats", "barley", "sweetPotato", "peas", "chickpeas", "lentils", "pumpkin", "flaxseed", "fishOil", "chickenFat", "chickenLiver", "venison", "whitefish", "herring", "glucosamine"]
    .map((k) => ({ key: "i:" + k, label: ING[k], term: ING[k][1].toLowerCase() })),
];
/* 點選的 + 手打的 → 一段文字，交給 checkProduct 比對 */
function combineIngredients(picked, extra) {
  const chosen = MANUAL_ING.filter((m) => picked.includes(m.key)).map((m) => m.term);
  return [...chosen, (extra || "").trim()].filter(Boolean).join(", ");
}

/* ==================================================================
   工具函式
================================================================== */

const li = (lang) => (lang === "zh" ? 0 : 1);
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

function ageParts(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday + "T00:00:00");
  const now = new Date();
  if (isNaN(b) || b > now) return null;
  let y = now.getFullYear() - b.getFullYear();
  let m = now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) m -= 1;
  if (m < 0) { y -= 1; m += 12; }
  return { y, m };
}
const ageText = (birthday, L) => { const a = ageParts(birthday); return a ? L.age(a.y, a.m) : "—"; };

function lifeStage(pet) {
  const a = ageParts(pet.birthday);
  const y = a ? a.y : 3;
  return y < 1 ? "young" : y <= 7 ? "adult" : "senior";
}

function breedKey(species, raw) {
  if (!raw) return "";
  const table = BREEDS[species] || {};
  if (table[raw]) return raw;
  const found = Object.keys(table).find((k) => table[k].includes(raw));
  return found || raw;
}
function breedLabel(species, raw, lang) {
  if (!raw) return "";
  const table = BREEDS[species] || {};
  const k = breedKey(species, raw);
  return table[k] ? table[k][li(lang)] : raw;
}
const ingName = (k, lang) => (ING[k] ? ING[k][li(lang)] : k);

/* 把過敏原 key 展開成一組比對用的詞；舊資料若是自由文字，模糊對應到最接近的選項 */
function expandAllergen(raw) {
  const a = String(raw).trim().toLowerCase();
  const terms = new Set([a]);
  if (ALLERGENS[a]) {
    ALLERGENS[a].terms.forEach((t) => terms.add(t.toLowerCase()));
  } else {
    for (const k of ALLERGEN_KEYS) {
      const g = ALLERGENS[k].terms;
      if (g.some((t) => t.toLowerCase() === a || (a.length >= 2 && (t.toLowerCase().includes(a) || a.includes(t.toLowerCase()))))) {
        g.forEach((t) => terms.add(t.toLowerCase()));
      }
    }
  }
  return [...terms].filter(Boolean);
}
function normalizeAllergen(raw) {
  if (ALLERGENS[raw]) return raw;
  const a = String(raw).trim().toLowerCase();
  return ALLERGEN_KEYS.find((k) => ALLERGENS[k].terms.some((t) => t.toLowerCase() === a || (a.length >= 2 && (t.toLowerCase().includes(a) || a.includes(t.toLowerCase()))))) || null;
}
const allergenLabel = (a, lang) => (ALLERGENS[a] ? ALLERGENS[a].label[li(lang)] : a);
const allergenList = (arr, lang, L) => (arr || []).map((a) => allergenLabel(a, lang)).join(L.join);

/* 商品目錄的成分是否含某過敏原 */
function ingredientMatches(ingKey, allergen) {
  const [zh, en] = ING[ingKey] || [ingKey, ingKey];
  const hay = (zh + " " + en).toLowerCase();
  return expandAllergen(allergen).some((t) => hay.includes(t));
}

/* 從商品名稱或分類文字推測年齡段 */
function inferStage(text) {
  const t = (text || "").toLowerCase();
  if (/all life|all ages|all stages|全齡|全年齡/.test(t)) return "all";
  if (/puppy|puppies|kitten|junior|growth|幼犬|幼貓|幼猫|幼/.test(t)) return "young";
  if (/senior|mature|aged|7\+|8\+|老|熟齡|熟龄|高齡|高龄/.test(t)) return "senior";
  if (/adult|成犬|成貓|成猫|成年/.test(t)) return "adult";
  return "unknown";
}

function foodAdvice(pet, L, lang) {
  const out = [];
  const stage = lifeStage(pet);
  const s = L.stage[stage][pet.species];
  if (stage === "young") out.push({ k: L.advice.age, v: L.advice.young(s) });
  else if (stage === "adult") out.push({ k: L.advice.age, v: L.advice.adult(s) });
  else out.push({ k: L.advice.age, v: L.advice.senior });
  if (pet.neutered) out.push({ k: L.advice.neutered, v: L.advice.neuteredV });
  if (pet.allergies?.length) out.push({ k: L.advice.allergies, v: L.advice.allergyV(allergenList(pet.allergies, lang, L)) });
  return out;
}

function recommendProducts(pet, L, lang) {
  const stage = lifeStage(pet);
  const allergies = pet.allergies || [];
  const w = Number(pet.weightKg) || 0;
  const dog = pet.species === "dog";
  const stageName = L.stage[stage][pet.species];
  const R = L.reasons;
  const results = [];
  for (const p of CATALOG) {
    if (p.species !== pet.species) continue;
    if (allergies.some((a) => p.ingredients.some((i) => ingredientMatches(i, a)))) continue;
    if (p.stage !== stage && p.stage !== "all") continue;
    let score = 0; const why = []; const warn = [];
    if (p.stage === stage) { score += 3; why.push(R.stageExact(stageName)); } else { score += 1; why.push(R.stageAll); }
    if (allergies.length) {
      score += 1; why.push(R.noAllergen(allergenList(allergies, lang, L)));
      if (p.tags.includes("single")) { score += 2; why.push(R.single(ingName(p.protein, lang))); }
    }
    if (pet.neutered) { if (p.tags.includes("weight")) { score += 2; why.push(R.neuteredWeight); } else warn.push(R.neuteredWarn); }
    if (stage === "senior") { if (p.tags.includes("joint")) { score += 2; why.push(R.seniorJoint); } else warn.push(R.seniorWarn); }
    if (dog && w > 0 && w < 10 && p.tags.includes("small")) { score += 1; why.push(R.small(w)); }
    if (dog && w > 25 && p.tags.includes("large")) { score += 1; why.push(R.large(w)); }
    results.push({ p, score, why, warn });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3);
}

/* 玩伴建議：依物種、月齡、體型、結紮、活動量 */
function playmateAdvice(pet, L) {
  const P = L.playmate;
  const a = ageParts(pet.birthday);
  const months = a ? a.y * 12 + a.m : 36;
  const w = Number(pet.weightKg) || 0;
  const out = [];
  if (pet.species === "dog") {
    if (months < 4) out.push({ k: P.k.age, v: P.dogUnder4m });
    else if (months < 12) out.push({ k: P.k.age, v: P.dogPuppy });
    else if (months <= 84) out.push({ k: P.k.age, v: P.dogAdult });
    else out.push({ k: P.k.age, v: P.dogSenior });
    if (w > 0) {
      if (w < 10) out.push({ k: P.k.size, v: P.dogSmall });
      else if (w <= 25) out.push({ k: P.k.size, v: P.dogMedium });
      else out.push({ k: P.k.size, v: P.dogLarge });
    }
    if (!pet.neutered && pet.gender === "male" && months >= 6) out.push({ k: P.k.status, v: P.dogIntactMale });
  } else {
    out.push({ k: P.k.nature, v: P.catGeneral });
    if (months < 12) out.push({ k: P.k.age, v: P.catKitten });
    else if (months <= 84) out.push({ k: P.k.age, v: P.catAdult });
    else out.push({ k: P.k.age, v: P.catSenior });
  }
  return out;
}

/* 檢查商品：只看過敏原與年齡段 */
function checkProduct(pet, prod) {
  const allergies = pet.allergies || [];
  const text = (prod.ingredients || "").toLowerCase();
  const hits = [];
  for (const a of allergies) {
    const terms = expandAllergen(a);
    const m = terms.find((t) => text.includes(t));
    if (m) hits.push({ allergen: a, term: m });
  }
  const petStage = lifeStage(pet);
  const stageStatus = prod.stage === "unknown" ? "unknown" : prod.stage === "all" ? "all" : prod.stage === petStage ? "ok" : "bad";
  let verdict;
  if (hits.length) verdict = "bad";
  else if (stageStatus === "bad") verdict = "stageMismatch";
  else if (stageStatus === "unknown") verdict = "stageUnknown";
  else verdict = "ok";
  return { hits, stageStatus, verdict, petStage, noAllergyRegistered: allergies.length === 0 };
}

/* ---- 外部資料 ---- */

async function lookupOPFF(code) {
  const r = await fetch(`https://world.openpetfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  if (!r.ok && r.status !== 404) throw new Error("http " + r.status);
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product;
  const name = p.product_name_en || p.product_name || "";
  const brand = p.brands || "";
  const ing = p.ingredients_text_en || p.ingredients_text || "";
  const stageText = [name, (p.categories_tags || []).join(" "), (p.labels_tags || []).join(" ")].join(" ");
  return { name: [brand, name].filter(Boolean).join(" "), ingredients: ing, stage: inferStage(stageText) };
}

/* ---- 條碼辨識（三層） ----
   ① BarcodeDetector：瀏覽器內建，Chrome / Android 有，iOS Safari 沒有
   ② ZXing：純 JavaScript 函式庫，所有瀏覽器都能跑，是 iPhone 的主力
   ③ AI 讀印刷數字：條碼本身糊掉時，讓 Claude 讀條碼下方那串數字，並做校驗碼檢查
   回傳 { code, via }，via 告訴畫面是哪一層讀到的（AI 讀的要提醒使用者核對） */

/* GS1 校驗碼（EAN-13 / EAN-8 / UPC-A 通用）：從右數起權重 3,1,3,1…，總和補到 10 的倍數 */
function validBarcode(s) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(s)) return false;
  const d = s.split("").map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/* Netlify 版：ZXing 從 npm 套件載入（package.json 裡的 @zxing/library） */
function loadZXing() {
  return Promise.resolve({ BrowserMultiFormatReader, DecodeHintType, BarcodeFormat });
}

async function decodeWithDetector(file) {
  if (!("BarcodeDetector" in window)) throw new Error("unsupported");
  const bmp = await createImageBitmap(file);
  const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  const codes = await det.detect(bmp);
  if (!codes.length) throw new Error("none");
  return codes[0].rawValue;
}

async function decodeWithZXing(file) {
  const ZXing = await loadZXing();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]);
  const reader = new ZXing.BrowserMultiFormatReader(hints);
  /* 太大的照片反而難讀；試兩種尺寸 */
  let lastErr = null;
  for (const size of [1200, 800]) {
    try {
      const url = await readImage(file, size);
      const r = await reader.decodeFromImageUrl(url);
      const text = r.getText();
      if (text) return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("none");
}

const BARCODE_PROMPT = `This photo shows a retail product barcode. Read the digits printed beneath or beside the bars.
Return ONLY a JSON object, no markdown, no explanation: {"barcode": string|null}
Digits only, no spaces. Typically 13 digits (EAN-13), 12 (UPC-A) or 8 (EAN-8).
If any digit is not clearly legible, return null. Never guess.`;

/* ---- 所有「把照片交給 AI」的功能都走這一個函式 ----
   Netlify 版：呼叫自己的後端 netlify/functions/vision.mjs，金鑰放在那邊。
   會附上登入 token，沒登入的人不能用（保護你的 API 額度）。 */
async function visionRequest(b64, prompt, maxTokens) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || "";
  const res = await fetch("/.netlify/functions/vision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: b64, prompt, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error("vision " + res.status);
  const body = await res.json();
  const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function readBarcodeDigitsWithAI(file) {
  const dataUrl = await readImage(file, 1400);
  const b64 = dataUrl.split(",")[1];
  const j = await visionRequest(b64, BARCODE_PROMPT, 200);
  const digits = String(j.barcode || "").replace(/\D/g, "");
  if (!validBarcode(digits)) throw new Error("ai-invalid");
  return digits;
}

async function scanBarcodeFromFile(file, onStage) {
  try { return { code: await decodeWithDetector(file), via: "detector" }; } catch { /* 下一層 */ }
  try { return { code: await decodeWithZXing(file), via: "zxing" }; } catch { /* 下一層 */ }
  if (onStage) onStage("ai");
  return { code: await readBarcodeDigitsWithAI(file), via: "ai" };
}

const LABEL_PROMPT = `This is a photo of a pet food package or its ingredient label.
Extract and return ONLY a JSON object, no markdown, no explanation:
{"product_name": string, "ingredients": string[] (each ingredient as printed, in the original language), "stage": "young"|"adult"|"senior"|"all"|"unknown"}
For "stage": young = puppy/kitten/junior/growth; senior = senior/mature/7+; all = all life stages; adult = adult; otherwise unknown.
If no ingredient list is visible, return an empty ingredients array.`;

async function readLabelWithAI(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const j = await visionRequest(b64, LABEL_PROMPT, 1000);
  const ingredients = Array.isArray(j.ingredients) ? j.ingredients.join(", ") : String(j.ingredients || "");
  const stage = ["young", "adult", "senior", "all"].includes(j.stage) ? j.stage : inferStage(j.product_name || "");
  return { name: j.product_name || "", ingredients, stage };
}

/* ---- 辨識寵物照片：物種與品種 ----
   重點是把答案「限定在我們自己的品種表裡」：AI 只能回傳 BREEDS 裡的代碼，
   回傳其他東西一律當作沒猜到。這樣不會出現表裡沒有的品種，剪影也能對上。 */
function breedCodeList(species) {
  return Object.keys(BREEDS[species]).filter((k) => k !== "other").map((k) => `${k} = ${BREEDS[species][k][1]}`).join(", ");
}
function buildGuessPrompt() {
  return `This is a photo of a pet. Identify the species and the most likely breed.
Return ONLY a JSON object, no markdown, no explanation:
{"species": "dog"|"cat"|null, "breed": string|null, "confidence": "high"|"medium"|"low"}
Rules:
- "species" is null if you cannot tell whether it is a dog or a cat, or if the photo shows neither.
- "breed" MUST be one of these codes, or null if unsure.
  Dog codes: ${breedCodeList("dog")}
  Cat codes: ${breedCodeList("cat")}
- Use "mix" when it looks like a mixed breed or you are unsure between breeds. Do not invent a breed that is not in the list.
- "confidence" reflects how sure you are about the breed. Puppies and kittens are hard; lean toward "low".`;
}
async function guessPetWithAI(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const j = await visionRequest(b64, buildGuessPrompt(), 200);
  const species = j.species === "dog" || j.species === "cat" ? j.species : null;
  const breed = species && j.breed && BREEDS[species][j.breed] && j.breed !== "other" ? j.breed : null;
  const confidence = ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "low";
  return { species, breed, confidence };
}

function readImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("decode"));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error("read"));
    fr.readAsDataURL(file);
  });
}

/* ==================================================================
   主元件
================================================================== */

export default function PetJournal() {
  const [pets, setPets] = useState([]);
  const [lang, setLangState] = useState(() => loadLang());
  const [session, setSession] = useState(undefined); // undefined = 還在確認、null = 沒登入
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [view, setView] = useState({ name: "list" });
  const [storageOk, setStorageOk] = useState(true);
  const L = STR[lang];

  /* 登入狀態：開頁時問一次，之後有變化（點了信裡的連結、登出）會自動通知 */
  const [anonErr, setAnonErr] = useState(""); // 顯示 Supabase 回的原始錯誤，方便排查
  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) { setSession(data.session); return; }
      if (AUTH_MODE !== "anonymous") { setSession(null); return; }
      /* 訪客模式：沒登入就自動開一個匿名帳號，同一個瀏覽器之後都會認得 */
      const { data: a, error } = await supabase.auth.signInAnonymously();
      if (error || !a.session) { setAnonErr((error && (error.message || String(error))) || "no session returned"); setSession(null); } else setSession(a.session);
    }).catch((e) => { setAnonErr(e?.message || String(e)); setSession(null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { if (s) setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* 登入後從雲端載入自己的寵物 */
  useEffect(() => {
    if (!session) { setPets([]); setView({ name: "list" }); return; }
    let alive = true;
    setLoading(true); setLoadErr(false);
    loadPets()
      .then((rows) => { if (alive) setPets(rows); })
      .catch(() => { if (alive) setLoadErr(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  function setLang(l) { setLangState(l); saveLang(l); }

  /* 先更新畫面，再寫雲端；寫失敗就亮出提醒 */
  async function savePet(pet) {
    const exists = pets.some((p) => p.id === pet.id);
    setPets(exists ? pets.map((p) => (p.id === pet.id ? pet : p)) : [...pets, pet]);
    setView({ name: "detail", id: pet.id });
    try { await upsertPet(pet, session.user.id); setStorageOk(true); } catch { setStorageOk(false); }
  }
  async function removePet(id) {
    setPets(pets.filter((p) => p.id !== id));
    setView({ name: "list" });
    try { await deletePet(id); setStorageOk(true); } catch { setStorageOk(false); }
  }
  async function logout() { try { await supabase.auth.signOut(); } catch { /* 忽略 */ } }

  const current = pets.find((p) => p.id === view.id);

  let body;
  if (!supabaseConfigured) body = <div className="pp-notice">{L.auth.notConfigured}</div>;
  else if (session === undefined || loading) body = <div className="pp-notice">{L.loading}</div>;
  else if (!session) body = AUTH_MODE === "anonymous"
    ? <div className="pp-notice">{anonErr ? L.auth.anonFail : L.loading}{anonErr && <div style={{ marginTop: 14, fontFamily: "var(--font-type)", fontSize: 11, wordBreak: "break-all" }}>Supabase: {anonErr}</div>}</div>
    : <Login />;
  else if (loadErr) body = <div className="pp-notice">{L.auth.loadFail}</div>;
  else if (view.name === "form") body = <PetForm pet={current} onCancel={() => setView(current ? { name: "detail", id: current.id } : { name: "list" })} onSave={savePet} />;
  else if (view.name === "check" && current) body = <CheckProduct pet={current} onBack={() => setView({ name: "detail", id: current.id })} />;
  else if (view.name === "detail" && current) body = <Detail pet={current} onBack={() => setView({ name: "list" })} onEdit={() => setView({ name: "form", id: current.id })} onCheck={() => setView({ name: "check", id: current.id })} onDelete={() => removePet(current.id)} />;
  else body = <List pets={pets} storageOk={storageOk} email={session.user.is_anonymous ? L.auth.guest : session.user.email} onLogout={session.user.is_anonymous ? null : logout} onOpen={(id) => setView({ name: "detail", id })} onAdd={() => setView({ name: "form" })} />;

  return (
    <LangCtx.Provider value={{ lang, L, setLang }}>
      <div className="pp">
        <style>{CSS}</style>
        {body}
      </div>
    </LangCtx.Provider>
  );
}

/* ---------------- 登入頁 ---------------- */

function Login() {
  const { L } = useL();
  const A = L.auth;
  const [email, setEmail] = useState("");
  const [state, setState] = useState(""); // "" | sending | sent | error

  async function send() {
    const e = email.trim();
    if (!e || state === "sending") return;
    setState("sending");
    /* 寄魔法連結；使用者點了連結會回到這個網址，Supabase 會自動完成登入 */
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { emailRedirectTo: window.location.origin } });
    setState(error ? "error" : "sent");
  }

  return (
    <>
      <header className="pp-top">
        <div className="pp-banner">
          <span className="tape c" />
          <h1 className="pp-title">{L.title}</h1>
          <div className="pp-sub">{L.sub}</div>
        </div>
        <PawSticker />
        <div className="pp-count">{L.notIssued}</div>
        <LangToggle />
      </header>
      <div className="paper pp-page">
        <span className="tape" />
        <div className="pp-form">
          <h2 className="pp-tier-h">{A.title}</h2>
          <p className="pp-tier-d">{A.intro}</p>
          <div className="pp-field">
            <label className="pp-label" htmlFor="em">{A.email}</label>
            <input id="em" className="pp-input" type="email" inputMode="email" autoComplete="email" value={email}
              onChange={(e) => { setEmail(e.target.value); if (state !== "sending") setState(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="you@example.com" />
          </div>
          <button className="pp-btn" onClick={send} disabled={state === "sending" || state === "sent"}>{state === "sending" ? A.sending : A.send}</button>
          {state === "sent" && <div className="pp-msg soft" style={{ marginTop: 12 }}>{A.sent(email.trim())}</div>}
          {state === "error" && <div className="pp-msg" style={{ marginTop: 12 }}>{A.err}</div>}
          <div className="pp-hint" style={{ marginTop: 14 }}>{A.privacy}</div>
        </div>
      </div>
    </>
  );
}

function LangToggle() {
  const { lang, setLang } = useL();
  return (
    <div className="pp-lang" role="group" aria-label="Language">
      <button data-on={lang === "en" ? "1" : "0"} onClick={() => setLang("en")}>EN</button>
      <button data-on={lang === "zh" ? "1" : "0"} onClick={() => setLang("zh")}>中</button>
    </div>
  );
}

/* ---------------- 列表頁 ---------------- */

function List({ pets, onOpen, onAdd, storageOk, email, onLogout }) {
  const { lang, L } = useL();

  return (
    <>
      <header className="pp-top">
        <div className="pp-banner">
          <span className="tape c" />
          <h1 className="pp-title">{L.title}</h1>
          <div className="pp-sub">{L.sub}</div>
        </div>
        <PawSticker />
        <div className="pp-count">{pets.length > 0 ? L.issued(pets.length) : L.notIssued}</div>
        <div className="pp-count" style={{ marginTop: 6 }}>{email}</div>
        {onLogout && <button className="pp-link" onClick={onLogout}>{L.auth.logout}</button>}
        <LangToggle />
      </header>

      {!storageOk && <div className="pp-alert warn">{L.storageWarn}</div>}

      <div className="pp-body">
        {pets.length === 0 ? (
          <div className="pp-empty">
            <p>{L.empty1}<br />{L.empty2}</p>
            <button className="pp-btn" onClick={onAdd}>{L.createFirst}</button>
          </div>
        ) : (
          pets.map((p, i) => (
            <button key={p.id} className="pp-card" onClick={() => onOpen(p.id)}>
              <span className={`tape ${["", "b", "c"][i % 3]}`} />
              <div className="pp-card-in">
                <Photo src={p.photo} species={p.species} breed={p.breed} />
                <div style={{ minWidth: 0 }}>
                  <h2 className="pp-name">{p.name}</h2>
                  <div className="pp-meta">
                    {breedLabel(p.species, p.breed, lang) || L.speciesName[p.species]} · {ageText(p.birthday, L)}
                    <br />
                    {p.weightKg ? L.kg(p.weightKg) : L.weightUnknown}{p.neutered ? ` · ${L.neuteredTag}` : ""}{p.city ? ` · ${cityLabel(p.city, lang)}` : ""}
                  </div>
                </div>
              </div>
              <div className="pp-type">{L.est} {(p.birthday || "").replace(/-/g, ".")}</div>
            </button>
          ))
        )}
      </div>

      {pets.length > 0 && <button className="pp-fab" onClick={onAdd} aria-label={L.addPet}>＋</button>}
    </>
  );
}

/* ---------------- 詳細頁 ---------------- */

function Detail({ pet, onBack, onEdit, onCheck, onDelete }) {
  const { lang, L } = useL();
  const [confirm, setConfirm] = useState(false);
  const advice = foodAdvice(pet, L, lang);
  const picks = recommendProducts(pet, L, lang);
  const mates = playmateAdvice(pet, L);

  return (
    <>
      <nav className="pp-nav">
        <button onClick={onBack}>{L.back}</button>
        <span>NO. {pet.id.slice(0, 6).toUpperCase()}</span>
        <div className="pp-nav-right"><LangToggle /><button onClick={onEdit}>{L.edit}</button></div>
      </nav>

      <div className="paper pp-page">
        <span className="tape" />
        <div className="pp-page-head">
          <Photo src={pet.photo} species={pet.species} breed={pet.breed} big />
          <div style={{ minWidth: 0 }}>
            <h1 className="pp-big-name">{pet.name}</h1>
            <div className="pp-big-sub">
              {breedLabel(pet.species, pet.breed, lang) || L.speciesName[pet.species]}<br />{ageText(pet.birthday, L)}
            </div>
          </div>
        </div>
        <dl className="pp-fields">
          <Row k={L.rows.species} v={L.speciesName[pet.species]} />
          <Row k={L.rows.gender} v={L.gender[pet.gender] || "—"} />
          <Row k={L.rows.birthday} v={pet.birthday || "—"} />
          <Row k={L.rows.weight} v={pet.weightKg ? L.kg(pet.weightKg) : "—"} />
          <Row k={L.rows.neutered} v={pet.neutered ? L.neuteredYes : L.neuteredNo} />
          <Row k={L.rows.allergies} v={pet.allergies?.length ? allergenList(pet.allergies, lang, L) : L.noAllergy} />
          <Row k={L.rows.city} v={pet.city ? cityLabel(pet.city, lang) : "—"} />
          {pet.note && <Row k={L.rows.note} v={pet.note} />}
        </dl>
        <div className="pp-type">{L.est} {(pet.birthday || "").replace(/-/g, ".")}</div>
      </div>

      <div style={{ padding: "0 16px 20px" }}>
        <button className="pp-btn" onClick={onCheck}>{L.checkBtn}</button>
      </div>

      <div className="paper pp-annex">
        <span className="tape b" />
        <div className="pp-annex-h"><span className="pp-h">{L.annex1}</span><em>NOTE I</em></div>
        {advice.map((a, i) => <div className="pp-advice" key={i}><div className="k">{a.k}</div><div className="v">{a.v}</div></div>)}
      </div>

      <div className="paper pp-annex">
        <span className="tape c" />
        <div className="pp-annex-h"><span className="pp-h">{L.annex2}</span><em>NOTE II</em></div>
        {picks.length === 0 ? <div className="pp-none">{L.noProducts}</div> : picks.map((r, i) => (
          <div className="pp-prod" key={r.p.id}>
            <div className="pp-prod-top">
              <div style={{ minWidth: 0 }}>
                <div className="pp-prod-brand">{BRANDS[r.p.brand][li(lang)]} · {r.p.size}</div>
                <h3 className="pp-prod-name">{r.p.name[li(lang)]}</h3>
              </div>
              <div className="pp-rank">{i + 1}</div>
            </div>
            {r.p.tags.length > 0 && <div className="pp-tags">{r.p.tags.map((t) => <span className="pp-tag" key={t}>{L.tags[t]}</span>)}</div>}
            <div className="pp-prod-ing">{L.ingredientsLabel}{r.p.ingredients.map((k) => ingName(k, lang)).join(L.join)}</div>
            <div className="pp-why-h">{L.whyFor(pet.name)}</div>
            <ul className="pp-why">{r.why.map((w, j) => <li key={j}>{w}</li>)}</ul>
            {r.warn.length > 0 && <><div className="pp-why-h">{L.watchOut}</div><ul className="pp-why warn">{r.warn.map((w, j) => <li key={j}>{w}</li>)}</ul></>}
          </div>
        ))}
        <div className="pp-note">{L.disclaimer}</div>
      </div>

      <div className="paper pp-annex">
        <span className="tape" />
        <div className="pp-annex-h"><span className="pp-h">{L.annex3}</span><em>NOTE III</em></div>
        {mates.map((m, i) => <div className="pp-advice" key={i}><div className="k">{m.k}</div><div className="v">{m.v}</div></div>)}
        <div className="pp-note">{L.playmate.sources}</div>
      </div>

      <div style={{ padding: "0 16px 40px" }}>
        {confirm ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#9E3D57", lineHeight: 1.8 }}>{L.deleteConfirm(pet.name)}</div>
            <button className="pp-btn-danger" onClick={onDelete}>{L.deleteYes}</button>
            <button className="pp-btn-ghost" onClick={() => setConfirm(false)}>{L.cancel}</button>
          </div>
        ) : (
          <button className="pp-btn-ghost" onClick={() => setConfirm(true)}>{L.deleteBtn}</button>
        )}
      </div>
    </>
  );
}

function Row({ k, v }) { return <div className="pp-row"><dt>{k}</dt><dd>{v}</dd></div>; }

/* ---------------- 檢查商品 ---------------- */

function CheckProduct({ pet, onBack }) {
  const { lang, L } = useL();
  const C = L.check;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [prod, setProd] = useState(null); // { name, ingredients, stage, source }
  const [picked, setPicked] = useState([]); // 手動輸入時點選的成分 key
  const togglePick = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const barcodeRef = useRef(null);
  const labelCamRef = useRef(null);
  const labelFileRef = useRef(null);
  const [scanNote, setScanNote] = useState(""); // 條碼是 AI 讀的時候，提醒使用者核對

  const petStageName = L.stage[lifeStage(pet)][pet.species];
  const allergyText = pet.allergies?.length ? allergenList(pet.allergies, lang, L) : L.noAllergy;

  async function doLookup(c) {
    const clean = (c || code).replace(/\D/g, "");
    if (!clean) return;
    setBusy("lookup"); setMsg("");
    try {
      const r = await lookupOPFF(clean);
      if (!r) setMsg(C.notFound);
      else setProd({ ...r, source: "opff" });
    } catch { setMsg(C.netError); }
    setBusy("");
  }

  async function onBarcodePhoto(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    setBusy("scan"); setMsg(""); setScanNote("");
    try {
      const { code: v, via } = await scanBarcodeFromFile(file, (stage) => { if (stage === "ai") setBusy("scanai"); });
      setCode(v);
      if (via === "ai") setScanNote(C.scanByAI);
      await doLookup(v);
    } catch { setMsg(C.scanFail); setBusy(""); }
  }

  function onCodeChange(v) { setCode(v); setScanNote(""); }

  async function onLabelPhoto(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    setBusy("ai"); setMsg("");
    try {
      const dataUrl = await readImage(file, 1400);
      const r = await readLabelWithAI(dataUrl);
      setProd({ ...r, source: "ai" });
    } catch { setMsg(C.aiFail); }
    setBusy("");
  }

  const ingText = prod ? (prod.source === "manual" ? combineIngredients(picked, prod.ingredients) : prod.ingredients) : "";
  const result = prod && ingText.trim() ? checkProduct(pet, { ...prod, ingredients: ingText }) : null;
  const stageLabel = (s) => (s === "unknown" || s === "all") ? C.stages[s] : L.stage[s][pet.species];

  return (
    <>
      <nav className="pp-nav">
        <button onClick={onBack}>{L.back}</button>
        <span>{C.nav}</span>
        <div className="pp-nav-right"><LangToggle /></div>
      </nav>

      <div className="paper pp-tier" style={{ marginTop: 18 }}>
        <span className="tape c" />
        <h2 className="pp-tier-h">{C.title(pet.name)}</h2>
        <p className="pp-tier-d" style={{ marginBottom: 6 }}>{C.criteria}</p>
        <div className="pp-src">{C.petLine(petStageName, allergyText)}</div>
      </div>

      {!prod && (
        <>
          <div className="paper pp-tier">
            <span className="tape" />
            <h2 className="pp-tier-h">{C.tier1}</h2>
            <p className="pp-tier-d">{C.tier1d}</p>
            <div className="pp-inline">
              <input className="pp-input" inputMode="numeric" value={code} onChange={(e) => onCodeChange(e.target.value)} placeholder={C.barcodePh} />
              <button className="pp-btn" onClick={() => doLookup()} disabled={!!busy}>{busy === "lookup" ? C.searching : C.lookup}</button>
            </div>
            <button className="pp-btn-ghost" style={{ marginTop: 10 }} onClick={() => barcodeRef.current?.click()} disabled={!!busy}>
              {busy === "scan" ? C.scanning : busy === "scanai" ? C.scanAI : C.scan}
            </button>
            <input ref={barcodeRef} type="file" accept="image/*" capture="environment" onChange={onBarcodePhoto} style={{ display: "none" }} />
            <div className="pp-hint">{C.scanHint}</div>
            {scanNote && <div className="pp-msg soft">{scanNote}</div>}
            {msg && (msg === C.notFound || msg === C.netError || msg === C.scanFail) && <div className="pp-msg">{msg}</div>}
            <div className="pp-src">{C.opffNote}</div>
          </div>

          <div className="paper pp-tier">
            <span className="tape b" />
            <h2 className="pp-tier-h">{C.tier2}</h2>
            <p className="pp-tier-d">{C.tier2d}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="pp-btn" onClick={() => labelCamRef.current?.click()} disabled={!!busy}>{busy === "ai" ? C.reading : C.takeLabel}</button>
              <button className="pp-btn-ghost" onClick={() => labelFileRef.current?.click()} disabled={!!busy}>{C.pickLabel}</button>
              <input ref={labelCamRef} type="file" accept="image/*" capture="environment" onChange={onLabelPhoto} style={{ display: "none" }} />
              <input ref={labelFileRef} type="file" accept="image/*" onChange={onLabelPhoto} style={{ display: "none" }} />
            </div>
            {msg === C.aiFail && <div className="pp-msg">{msg}</div>}
          </div>

          <div className="paper pp-tier">
            <span className="tape c" />
            <h2 className="pp-tier-h">{C.tier3}</h2>
            <p className="pp-tier-d">{C.tier3d}</p>
            <button className="pp-btn-ghost" onClick={() => setProd({ name: "", ingredients: "", stage: "unknown", source: "manual" })}>{C.manualStart}</button>
          </div>
        </>
      )}

      {prod && (
        <div className="paper pp-tier">
          <span className="tape" />
          <h2 className="pp-tier-h">{C.productTitle}</h2>
          <div className="pp-src" style={{ marginTop: 0, marginBottom: 12 }}>{C.sourceLabel}{C.sources[prod.source]}</div>
          <div className="pp-field">
            <label className="pp-label">{C.nameLabel}</label>
            <input className="pp-input" value={prod.name} onChange={(e) => setProd({ ...prod, name: e.target.value })} />
          </div>
          {prod.source === "manual" ? (
            <>
              <div className="pp-field">
                <label className="pp-label">{C.pickIng}</label>
                <div className="pp-chips">
                  {MANUAL_ING.map((m) => (
                    <button key={m.key} type="button" className="pp-chip" data-on={picked.includes(m.key) ? "1" : "0"} onClick={() => togglePick(m.key)}>{m.label[li(lang)]}</button>
                  ))}
                </div>
              </div>
              <div className="pp-field">
                <label className="pp-label">{C.extraIng}</label>
                <textarea className="pp-textarea" value={prod.ingredients} onChange={(e) => setProd({ ...prod, ingredients: e.target.value })} placeholder={C.ingPh} />
                {ingText && <div className="pp-hint">{C.pickedPreview(ingText)}</div>}
              </div>
            </>
          ) : (
            <div className="pp-field">
              <label className="pp-label">{C.ingLabel}</label>
              <textarea className="pp-textarea" style={{ minHeight: 96 }} value={prod.ingredients} onChange={(e) => setProd({ ...prod, ingredients: e.target.value })} placeholder={C.ingPh} />
            </div>
          )}
          <div className="pp-field">
            <label className="pp-label">{C.stageLabel}</label>
            <select className="pp-select" value={prod.stage} onChange={(e) => setProd({ ...prod, stage: e.target.value })}>
              {["young", "adult", "senior", "all", "unknown"].map((s) => <option key={s} value={s}>{C.stages[s]}</option>)}
            </select>
          </div>
          <button className="pp-btn-ghost" onClick={() => { setProd(null); setPicked([]); setMsg(""); }}>{C.clear}</button>
        </div>
      )}

      {result && (
        <div className="paper pp-annex" style={{ paddingBottom: 6 }}>
          <span className="tape b" />
          <div className="pp-annex-h"><span className="pp-h">{C.resultTitle}</span></div>
          <div className={`pp-verdict ${result.verdict === "bad" ? "bad" : result.verdict === "ok" ? "" : "mid"}`}>{C.verdict[result.verdict]}</div>
          <div className="pp-res">
            {result.noAllergyRegistered ? <div className="unk">{C.petNoAllergy}</div>
              : result.hits.length ? <div className="bad">{C.allergenHit(result.hits.map((h) => `${allergenLabel(h.allergen, lang)}（${h.term}）`).join(L.join))}</div>
              : <div className="ok">{C.allergenNone}</div>}
            {result.stageStatus === "ok" && <div className="ok">{C.stageOk(stageLabel(prod.stage))}</div>}
            {result.stageStatus === "all" && <div className="ok">{C.stageAll}</div>}
            {result.stageStatus === "bad" && <div className="bad">{C.stageBad(stageLabel(prod.stage), petStageName)}</div>}
            {result.stageStatus === "unknown" && <div className="unk">{C.stageUnk}</div>}
          </div>
          <div className="pp-note">{C.resultNote}</div>
        </div>
      )}
      <div style={{ height: 40 }} />
    </>
  );
}

/* ---------------- 表單 ---------------- */

const EMPTY = { name: "", species: "dog", breed: "", gender: "", birthday: "", weightKg: "", neutered: false, allergies: [], city: "", note: "", photo: "" };

function PetForm({ pet, onSave, onCancel }) {
  const { lang, L } = useL();
  const F = L.form;
  const [f, setF] = useState(() => pet ? { ...EMPTY, ...pet, breed: breedKey(pet.species, pet.breed), allergies: (pet.allergies || []).map(normalizeAllergen).filter(Boolean), chipId: undefined, nextVaccine: undefined } : { ...EMPTY });
  const today = todayISO();
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const breedTable = BREEDS[f.species];
  const [breedOther, setBreedOther] = useState(() => !!(f.breed && !breedTable[f.breed]));
  const breedSel = breedOther ? "other" : breedTable[f.breed] ? f.breed : "";
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function changeSpecies(sp) {
    setF((s) => ({ ...s, species: sp, breed: breedOther || BREEDS[sp][s.breed] ? s.breed : "",
      weightKg: s.weightKg !== "" && Number(s.weightKg) > WT_RANGE[sp].max ? WT_RANGE[sp].max : s.weightKg }));
  }
  function toggleAllergen(k) { setF((s) => ({ ...s, allergies: s.allergies.includes(k) ? s.allergies.filter((x) => x !== k) : [...s.allergies, k] })); }
  function changeBreed(v) { if (v === "other") { setBreedOther(true); set("breed", ""); } else { setBreedOther(false); set("breed", v); } }
  const lastFileRef = useRef(null); // 原始照片檔，辨識時用較高解析度
  const [guessBusy, setGuessBusy] = useState(false);
  const [guessMsg, setGuessMsg] = useState("");
  async function pickPhoto(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    try { set("photo", await readImage(file)); lastFileRef.current = file; setGuessMsg(""); } catch { setErr(F.errPhoto); }
  }
  async function guessFromPhoto() {
    if (!f.photo || guessBusy) return;
    setGuessBusy(true); setGuessMsg("");
    try {
      const dataUrl = lastFileRef.current ? await readImage(lastFileRef.current, 900) : f.photo;
      const g = await guessPetWithAI(dataUrl);
      if (!g.species) { setGuessMsg(F.guessNone); }
      else {
        setBreedOther(false);
        setF((s) => ({ ...s, species: g.species, breed: g.breed || "" }));
        setGuessMsg(F.guessDone(L.speciesName[g.species], g.breed ? breedLabel(g.species, g.breed, lang) : "", F.conf[g.confidence]));
      }
    } catch { setGuessMsg(F.guessFail); }
    setGuessBusy(false);
  }
  function submit() {
    if (!f.name.trim()) return setErr(F.errName);
    if (!f.birthday) return setErr(F.errBirthday);
    if (f.birthday > today) return setErr(F.errFuture);
    setErr("");
    onSave({ ...f, id: pet?.id || uid(), name: f.name.trim(), breed: f.breed.trim(), weightKg: f.weightKg === "" ? "" : Number(f.weightKg),
      allergies: f.allergies, createdAt: pet?.createdAt || new Date().toISOString() });
  }

  return (
    <>
      <nav className="pp-nav">
        <button onClick={onCancel}>{L.cancelNav}</button>
        <span>{pet ? F.editLabel : F.newLabel}</span>
        <div className="pp-nav-right"><LangToggle /></div>
      </nav>

      <div className="paper" style={{ margin: "18px 16px 0" }}>
        <span className="tape b" />
        <div className="pp-form">
          <div className="pp-field">
            <label className="pp-label">{F.photo}</label>
            <div className="pp-photo-pick">
              <Photo src={f.photo} species={f.species} breed={f.breed} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="pp-btn" onClick={() => camRef.current?.click()}>{F.takePhoto}</button>
                <button className="pp-btn-ghost" onClick={() => fileRef.current?.click()}>{F.fromGallery}</button>
                <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} style={{ display: "none" }} />
                <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} style={{ display: "none" }} />
              </div>
            </div>
            <div className="pp-hint">{F.photoHint}</div>
            {f.photo && (
              <div style={{ marginTop: 12 }}>
                <button className="pp-btn-ghost" onClick={guessFromPhoto} disabled={guessBusy}>{guessBusy ? F.guessing : F.guess}</button>
                <div className="pp-hint">{F.guessHint}</div>
                {guessMsg && <div className="pp-msg soft" style={{ color: "#3B3024" }}>{guessMsg}</div>}
              </div>
            )}
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="nm">{F.name}<i>*</i></label>
            <input id="nm" className="pp-input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={F.namePh} />
          </div>

          <div className="pp-field">
            <label className="pp-label">{F.species}<i>*</i></label>
            <div className="pp-seg">
              <button data-on={f.species === "dog" ? "1" : "0"} onClick={() => changeSpecies("dog")}>{F.dog}</button>
              <button data-on={f.species === "cat" ? "1" : "0"} onClick={() => changeSpecies("cat")}>{F.cat}</button>
            </div>
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="br">{F.breed}</label>
            <select id="br" className="pp-select" value={breedSel} onChange={(e) => changeBreed(e.target.value)}>
              <option value="">{F.pick}</option>
              {Object.keys(breedTable).map((k) => <option key={k} value={k}>{breedTable[k][li(lang)]}</option>)}
            </select>
            {breedOther && <input className="pp-input" style={{ marginTop: 8 }} value={f.breed} onChange={(e) => set("breed", e.target.value)} placeholder={F.breedOtherPh} autoFocus />}
          </div>

          <div className="pp-field">
            <label className="pp-label">{F.gender}</label>
            <div className="pp-seg">
              <button data-on={f.gender === "male" ? "1" : "0"} onClick={() => set("gender", "male")}>{F.male}</button>
              <button data-on={f.gender === "female" ? "1" : "0"} onClick={() => set("gender", "female")}>{F.female}</button>
            </div>
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="bd">{F.birthday}<i>*</i></label>
            <input id="bd" className="pp-input" type="date" max={today} value={f.birthday} onChange={(e) => set("birthday", e.target.value)} />
            <div className="pp-hint">{F.birthdayHint}</div>
          </div>

          <div className="pp-field">
            <label className="pp-label">{F.weight}</label>
            <WeightPicker value={f.weightKg} species={f.species} onChange={(v) => set("weightKg", v)} />
            <div className="pp-hint">{F.weightHint}</div>
          </div>

          <div className="pp-field">
            <label className="pp-label">{F.neutered}</label>
            <div className="pp-seg">
              <button data-on={f.neutered ? "1" : "0"} onClick={() => set("neutered", true)}>{F.yes}</button>
              <button data-on={!f.neutered ? "1" : "0"} onClick={() => set("neutered", false)}>{F.no}</button>
            </div>
          </div>

          <div className="pp-field">
            <label className="pp-label">{F.allergies}</label>
            <div className="pp-chips">
              {ALLERGEN_KEYS.map((k) => (
                <button key={k} type="button" className="pp-chip" data-on={f.allergies.includes(k) ? "1" : "0"} onClick={() => toggleAllergen(k)}>
                  {allergenLabel(k, lang)}
                </button>
              ))}
            </div>
            <div className="pp-hint">{F.allergiesHint}</div>
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="ct">{F.city}</label>
            <select id="ct" className="pp-select" value={f.city || ""} onChange={(e) => set("city", e.target.value)}>
              <option value="">{F.pick}</option>
              {Object.keys(CITIES).map((k) => <option key={k} value={k}>{CITIES[k][li(lang)]}</option>)}
            </select>
            <div className="pp-hint">{F.cityHint}</div>
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="nt">{F.note}</label>
            <textarea id="nt" className="pp-textarea" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={F.notePh} />
          </div>

          {err && <div className="pp-err">{err}</div>}

          <div className="pp-actions">
            <button className="pp-btn" onClick={submit}>{pet ? F.save : F.issue}</button>
            <button className="pp-btn-ghost" onClick={onCancel}>{F.cancel}</button>
          </div>
        </div>
      </div>
      <div style={{ height: 40 }} />
    </>
  );
}


/* ---- 體重拉桿：拉大概位置，用 −／＋ 微調 0.1 ---- */
const WT_RANGE = { dog: { min: 0.5, max: 60, def: 10 }, cat: { min: 0.5, max: 15, def: 4 } };
function WeightPicker({ value, species, onChange }) {
  const { L } = useL();
  const F = L.form;
  const r = WT_RANGE[species] || WT_RANGE.dog;
  const has = value !== "" && value != null && !isNaN(Number(value));
  const v = has ? Math.min(r.max, Math.max(r.min, Number(value))) : r.def;
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  const setV = (n) => onChange(Math.round(Math.min(r.max, Math.max(r.min, n)) * 10) / 10);
  return (
    <>
      <div className="pp-wt">
        <div className="pp-wt-val" data-empty={has ? "0" : "1"}>{has ? fmt(v) : "—"}<small>kg</small></div>
        <button type="button" className="pp-wt-btn" onClick={() => setV(v - 0.1)} aria-label="-0.1 kg">−</button>
        <button type="button" className="pp-wt-btn" onClick={() => setV(v + 0.1)} aria-label="+0.1 kg">＋</button>
        {has && <button type="button" className="pp-wt-clear" onClick={() => onChange("")}>{F.weightClear}</button>}
      </div>
      <input className="pp-range" type="range" min={r.min} max={r.max} step="0.1" value={v} onChange={(e) => setV(Number(e.target.value))} aria-label={F.weight} />
      <div className="pp-range-scale"><span>{r.min} kg</span><span>{r.max} kg</span></div>
    </>
  );
}

/* ---------------- 小元件 ---------------- */

function Photo({ src, species, breed, big }) {
  const cls = `pp-photo${big ? " big" : ""}`;
  return (
    <div className="pp-photo-wrap">
      {src ? (
        <img className={cls} src={src} alt="" />
      ) : (
        <div className={cls} style={{ color: "#B5A48A" }}>
          <svg viewBox="0 0 100 100" width="100%" height="100%" fill="currentColor" aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: SIL[silhouetteFor(species, breed)] }} />
        </div>
      )}
      <span className="pp-corner tl" /><span className="pp-corner tr" /><span className="pp-corner bl" /><span className="pp-corner br" />
    </div>
  );
}

function Paw({ size = 24, color = "#3B3024" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" fill={color} aria-hidden="true">
      <ellipse cx="21" cy="27" rx="7.2" ry="6" />
      <ellipse cx="12.6" cy="18.6" rx="3.1" ry="4" />
      <ellipse cx="18.4" cy="13.8" rx="3" ry="3.9" />
      <ellipse cx="23.6" cy="13.8" rx="3" ry="3.9" />
      <ellipse cx="29.4" cy="18.6" rx="3.1" ry="4" />
    </svg>
  );
}

function PawSticker() {
  return (
    <div className="pp-paw" style={{ width: 46, height: 46, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(59,48,36,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Paw size={28} />
    </div>
  );
}
