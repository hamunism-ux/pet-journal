import { useState, useEffect, useRef, createContext, useContext } from "react";
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from "@zxing/library";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { AUTH_MODE } from "./config.js";
import { loadPets, upsertPet, deletePet, loadLang, saveLang } from "./lib/db";

/* ------------------------------------------------------------------
   宠物护照 v2 — 手帐风格版（新 artifact，旧版不受影响）

   新增：
   1. 检查商品：条码查 Open Pet Food Facts → 拍成分表由 AI 读 → 手动输入
      只判断两件事：有没有含过敏原、年龄段对不对
   2. 玩伴建议：依物种／月龄／体型／结扎／活动量给文字建议（附参考来源）
   3. 视觉改为日系手帐／宠物相簿风格

   v2.2：拍条码改为三层辨识，iPhone 也能用
      ① 浏览器内建 BarcodeDetector（Chrome / Android）
      ② ZXing 函式库（所有浏览器含 iOS Safari；artifact 从 CDN 载入，Netlify 版改用 npm 套件）
      ③ AI 读条码下方印刷的数字（会做校验码检查，并提示使用者核对）
      都失败才请使用者手动输入

   v2.3：表单里有照片时，可以让 AI 猜物种与品种（限定回传 BREEDS 里的代码），
      自动选好下拉选单并标示把握程度，使用者可直接改

   v3.0（云端版）：资料改存 Supabase，需要 Email 登入。
      和 artifact 版的差别只有四处：import、visionRequest、loadZXing、主元件 PetJournal 与 Login。
      其他画面与逻辑完全相同。

   v2.4：移除晶片号码与疫苗到期提醒（栏位、首页便利贴、详细页贴纸）。
      多笔健康纪录（含疫苗）之后以独立功能加回。

   v2.5：体重改成拉杆（依物种给范围）＋ −／＋ 微调 0.1 公斤，可清除。

   v2.5.1：首页标题横幅摆正（顺便修掉 .pp-label 与表单标签同名互相覆盖的问题）。

   v2.6：商品检查的手动输入改成「常见成分点选（多选）＋自由文字补充」，两者合并后比对。

   v2.7：新增「所在城市」栏位（下拉选单，存代码，显示时翻译；资料库加 city 栏）。

   v2.7.1：所有方框、卡片、贴纸、纸胶带全部摆正，不再有任何旋转。

   v2.8：表单有照片时多一颗「移除照片」，清掉照片与辨识结果，回到剪影状态。

   v2.9：推荐商品只显示最合适的 1 款；「玩伴建议」改为「养育建议」（运动／美容／健康／环境／社交），
      依物种、月龄、体型、品种类型、结扎、过敏原自动产生。

   v2.10：「检查一款商品」按钮改醒目样式；商品检查移除「拍成分表由 AI 读」那一层，剩条码查询与手动输入。

   v2.11：检查按钮改回深棕色（保留较大尺寸）；宠物档案新增「主人 Email」（选填，资料库加 owner_email 栏）。

   v2.11.1：城市选项缩减为新加坡、枫丹白露、阿布达比、其他。

   v3.1：新增「寻找附近的玩伴」：同城同物种的其他宠物清单，依年龄阶段／体型／结扎挑最佳配对并附理由，
      只有最佳配对显示主人 Email。Netlify 版透过资料库函式 find_playmates()（见 supabase/migrate-v4-playmates.sql）。

   v3.1.1：城市名称前加国旗 emoji（新加坡 🇸🇬、枫丹白露 🇫🇷、阿布达比 🇦🇪、其他 🌍）。

   v3.2：推荐商品理由与养育建议全部改短、改白话；免责声明也缩短。

   v3.3：移除首页帐号状态列与 SINCE 日期列；首页底部显示全站统计（主人数＝不重复 owner_id、宠物数＝笔数）。

   v3.4：次要文字颜色加深（对比度）；中文介面全部改为简体中文（过敏原比对词保留繁简两套）。

   v3.5：照片改存 Supabase Storage（pet-photos 桶），资料表 photo 栏只存网址；旧的 data: 照片仍可显示，下次编辑时自动搬过去。

   v3.5.1：照片上限改 8 MB，表单加提示。

   v3.6：商品检查新增首选「拍摄商品外观」：AI 辨识商品＋上网查成分＋对照宠物资料给出合适／不合适与理由；
      规则比对仍在下方一并显示。Netlify 版走 Supabase Edge Function check-food（可跑 150 秒）。

   v3.6.1：AI 处理中显示小转圈；商品检查页文案改为「拍照＝AI 综合判断、条码／手动＝只比对过敏原与年龄段」，全部精简。

   v3.7：条码／手动输入也可一键让 AI 综合判断（文字模式）；AI 理由同时回传中英文，依介面语言显示。

   v3.7.1：有 AI 判断时不再显示规则比对；AI 综合判断区块改粗框醒目样式。

   v3.8：AI 判断降低费用：预设不上网、只回 JSON、输出上限 700、照片缩到 1000px；AI 不确定时才提供「上网查证」按钮。

   v3.8.1：AI 判断加速：不上网时预填 JSON 开头（省掉开场白）、输出上限 400、理由各 2 句、成分最多 12 项、照片 800px。

   v3.8.2：换回 Sonnet 以提高辨识品质；理由 2–3 句、成分最多 15 项、输出上限 600、照片 1000px（预填 JSON 保留）。

   v3.8.3：拿掉「预填 JSON 开头」（Sonnet 4.6 不支援预填，会直接报错）；失败时画面显示原始错误原因。

   v3.8.4：商品检查页顶部只留标题，拿掉说明小字与宠物状态行。

   v3.9：建档／编辑选好照片后自动让 AI 辨识物种与品种并预选（已选品种时不覆盖）；按钮改为「重新辨识」。
      Netlify 版的 AI 呼叫改走 Supabase Edge Function check-food，金钥只需设在 Supabase 一处。

   v3.9.1：表单照片区文案精简。

   v3.9.2：表单必填项（名字、物种、生日）标签加粗、星号醒目，表单顶端一行「＊必填」。

   资料存放：Supabase（见 src/lib/db.js、supabase/schema.sql）；语言偏好存 localStorage
------------------------------------------------------------------ */

const CSS = `
.pp{
  --paper:#D8C6A2;
  --card:#FBF6EA;
  --ink:#3B3024;
  --ink-soft:#5A4B38;
  --rule:#E6DAC2;
  --tape-a:#8DB7A6;
  --tape-b:#E4AFA7;
  --tape-c:#E5C15E;
  --berry:#9E3D57;
  --ok:#5F8A5B;
  --font-round:ui-rounded,"Hiragino Maru Gothic ProN","Yu Gothic UI","Arial Rounded MT Bold","Noto Sans SC",sans-serif;
  --font-type:"Courier New",Courier,monospace;

  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;
  color:var(--ink);
  background-color:var(--paper);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.pp *{box-sizing:border-box;}
.pp button{font-family:inherit;cursor:pointer;}
.pp :focus-visible{outline:2px solid var(--berry);outline-offset:2px;}

/* ---- 纸胶带 ---- */
.tape{
  position:absolute;top:-9px;left:18px;width:72px;height:20px;
  background-color:var(--tape-a);opacity:.92;
  background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0) 0 5px,rgba(255,255,255,.38) 5px 7px);
  border-radius:1px;box-shadow:0 1px 2px rgba(59,48,36,.12);pointer-events:none;
}
.tape.b{background-color:var(--tape-b);left:auto;right:22px;}
.tape.c{background-color:var(--tape-c);}

/* ---- 纸卡 ---- */
.paper{
  position:relative;background:var(--card);border-radius:3px;
  box-shadow:0 2px 6px rgba(59,48,36,.16);
}

/* ---- 页首：牛皮笔记本封面 + 贴纸标签 ---- */
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

/* ---- 语言切换：贴纸 ---- */
.pp-lang{
  display:inline-flex;background:#fff;border-radius:999px;padding:2px;
  box-shadow:0 1px 3px rgba(59,48,36,.2);
}
.pp-lang button{
  background:transparent;border:none;color:var(--ink-soft);
  font-family:var(--font-round);font-size:11px;padding:4px 10px;border-radius:999px;
}
.pp-lang button[data-on="1"]{background:var(--ink);color:#FBF6EA;}

/* ---- 便利贴提醒 ---- */
.pp-alert{
  margin:16px 16px 0;background:#FCEFC3;padding:12px 14px;border-radius:2px;
  box-shadow:0 2px 4px rgba(59,48,36,.16);
  font-size:13px;color:var(--ink);line-height:1.65;
}
.pp-alert b{font-weight:700;}
.pp-alert.warn{background:#F4DADF;}

.pp-body{padding:20px 16px 110px;}
.pp-stats{text-align:center;font-family:var(--font-type);font-size:11px;letter-spacing:.1em;color:var(--ink-soft);padding:14px 16px 0;line-height:1.9;}

/* ---- 相簿卡片 ---- */
.pp-card{
  position:relative;width:100%;text-align:left;padding:0;display:block;
  background:var(--card);border:none;border-radius:3px;
  box-shadow:0 2px 6px rgba(59,48,36,.16);margin:0 0 20px;
}
.pp-card-in{display:flex;gap:16px;padding:18px 16px 18px;}

/* ---- 相片 + 相角 ---- */
.pp-photo-wrap{position:relative;flex:0 0 auto;}
.pp-photo{
  width:78px;height:96px;display:flex;align-items:center;justify-content:center;
  border:4px solid #fff;box-shadow:0 1px 4px rgba(59,48,36,.22);
  background:#EFE7D6;object-fit:cover;color:#9C8D74;
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

/* ---- 空状态 ---- */
.pp-empty{text-align:center;padding:54px 24px;}
.pp-empty p{color:var(--ink-soft);font-size:14px;line-height:1.9;margin:0 0 22px;}

/* ---- 按钮 ---- */
.pp-btn{
  background:var(--ink);color:#FBF6EA;border:none;
  padding:14px 22px;border-radius:10px;font-size:15px;
  font-family:var(--font-round);width:100%;
}
.pp-btn-check{
  background:var(--ink);color:#FBF6EA;border:none;width:100%;
  padding:17px 22px;border-radius:12px;font-size:16px;font-weight:700;
  font-family:var(--font-round);letter-spacing:.02em;
  box-shadow:0 4px 12px rgba(59,48,36,.28);
}
.pp-btn-check:active{transform:translateY(1px);box-shadow:0 2px 6px rgba(59,48,36,.26);}
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

/* ---- 导览 ---- */
.pp-nav{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 4px;}
.pp-nav > button{background:none;border:none;color:var(--ink);font-size:14px;padding:6px 4px;font-family:var(--font-round);}
.pp-nav > span{font-family:var(--font-type);font-size:11px;letter-spacing:.18em;color:var(--ink-soft);}
.pp-nav-right{display:flex;align-items:center;gap:10px;}
.pp-nav-right > button{background:none;border:none;color:var(--ink);font-size:14px;padding:6px 4px;font-family:var(--font-round);}

/* ---- 详细页 ---- */
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

/* ---- 推荐商品 ---- */
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


/* ---- 体重拉杆 ---- */
.pp-wt{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.pp-wt-val{font-family:var(--font-round);font-size:28px;font-weight:700;min-width:92px;line-height:1;}
.pp-wt-val[data-empty="1"]{color:#9C8D74;}
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

/* ---- 玩伴清单 ---- */
.pp-mate{position:relative;background:var(--card);border-radius:3px;box-shadow:0 2px 6px rgba(59,48,36,.16);margin:0 16px 16px;}
.pp-mate.match{background:#FFF6DA;box-shadow:0 0 0 3px var(--tape-c),0 4px 12px rgba(59,48,36,.22);}
.pp-mate-badge{position:absolute;right:14px;top:-10px;background:var(--berry);color:#fff;font-family:var(--font-round);
  font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px;box-shadow:0 2px 4px rgba(59,48,36,.2);letter-spacing:.04em;}
.pp-mate-why{padding:0 16px 12px;}
.pp-mate-contact{margin:0 16px 14px;padding:12px 14px;background:#fff;border-radius:8px;font-size:14px;word-break:break-all;
  border:1px dashed var(--ink-soft);}
.pp-mate-contact .k{font-size:11px;color:var(--ink-soft);font-family:var(--font-round);margin-bottom:4px;}

/* ---- 表单 ---- */
.pp-form{padding:12px 16px 40px;}
.pp-field{margin-bottom:18px;}
.pp-label{display:block;font-size:12.5px;color:var(--ink-soft);margin-bottom:7px;font-family:var(--font-round);}
.pp-label i{font-style:normal;color:var(--berry);margin-left:3px;}
.pp-label.req{color:var(--ink);font-weight:700;font-size:13.5px;}
.pp-label.req i{font-size:15px;font-weight:700;}
.pp-req-note{font-size:11.5px;color:var(--berry);margin:0 0 14px;font-family:var(--font-round);}
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

/* ---- 等待转圈 ---- */
.pp-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(251,246,234,.35);border-top-color:#FBF6EA;
  border-radius:50%;vertical-align:-2px;margin-right:8px;animation:ppspin .8s linear infinite;}
@keyframes ppspin{to{transform:rotate(360deg);}}
.pp-wait{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12.5px;color:var(--ink-soft);}
.pp-wait .pp-spin{border-color:rgba(59,48,36,.2);border-top-color:var(--ink);margin:0;}

/* ---- AI 综合判断：粗框 ---- */
.pp-ai{border:3px solid var(--ink);box-shadow:0 5px 14px rgba(59,48,36,.24);}
.pp-ai .pp-annex-h{padding-top:18px;}
.pp-ai .pp-h{font-size:17px;background:linear-gradient(transparent 58%,rgba(229,193,94,.75) 58%);}
.pp-ai .pp-verdict{font-size:18px;padding:11px 22px;margin-top:10px;}
.pp-ai .pp-res{font-size:14.5px;line-height:1.85;padding-top:12px;}

/* ---- 检查商品 ---- */
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
    title: "宠物手帐",
    sub: "PET PASSPORT",
    loading: "翻开手帐中…",
    auth: {
      title: "登入手帐",
      intro: "输入 Email，我们寄一个登入连结给你，点了就进来，不用密码。换手机也只要再登入一次，资料都还在。",
      email: "Email",
      send: "寄登入连结",
      sending: "寄送中…",
      sent: (e) => `已寄到 ${e}。请到信箱点连结（找不到请看垃圾邮件）。`,
      err: "寄送失败，请确认 Email 再试一次。",
      privacy: "你的宠物资料只有你登入后看得到。",
      logout: "登出",
      notConfigured: "还没填资料库连线。请打开 src/config.js 贴上 Supabase 的 URL 和 anon key，再重新上传。",
      anonFail: "自动登入失败。请到 Supabase 后台 Authentication → Sign In / Providers，打开「Allow anonymous sign-ins」。",
      loadFail: "读取资料失败，请重新整理再试。",
    },
    issued: (n) => `${n} 位家庭成员`,
    notIssued: "还没有家庭成员",
    stats: (o, p) => `本宠物世界已有 ${o} 位主人加入，共 ${p} 只宠物`,
    storageWarn: "资料暂时无法储存，这次的修改在重新整理后可能会消失。",
    empty1: "这本手帐还是空的。",
    empty2: "先把牠贴上来吧。",
    createFirst: "新增第一位成员",
    addPet: "新增宠物",
    weightUnknown: "体重未填",
    kg: (w) => `${w} 公斤`,
    neuteredTag: "已结扎",
    back: "← 返回",
    edit: "编辑",
    cancelNav: "← 取消",
    join: "、",
    speciesName: { dog: "犬", cat: "猫" },
    rows: {
      species: "物种", gender: "性别", birthday: "生日", weight: "体重", neutered: "结扎",
      allergies: "过敏原", city: "所在城市", ownerEmail: "主人 Email", note: "备注",
    },
    gender: { male: "公", female: "母" },
    neuteredYes: "已结扎",
    neuteredNo: "未结扎",
    noAllergy: "无",
    annex1: "营养方向",
    annex2: "推荐商品",
    annex3: "养育建议",
    checkBtn: "检查一款商品适不适合牠",
    noProducts: "目前的目录里没有能避开所有过敏原、又符合年龄阶段的商品。建议直接咨询兽医，或考虑处方饲料。",
    ingredientsLabel: "主要成分：",
    whyFor: (n) => `为什么适合 ${n}`,
    watchOut: "要留意",
    disclaimer: "商品为示范资料。建议仅供参考，请以兽医意见为准。",
    deleteBtn: "移除这位成员",
    deleteConfirm: (n) => `删除后无法复原。确定要移除 ${n} 吗？`,
    deleteYes: "确定移除",
    cancel: "取消",
    age: (y, m) => (y === 0 ? `${m} 个月` : m === 0 ? `${y} 岁` : `${y} 岁 ${m} 个月`),
    stage: { young: { dog: "幼犬", cat: "幼猫" }, adult: { dog: "成犬", cat: "成猫" }, senior: { dog: "熟龄犬", cat: "熟龄猫" } },
    advice: {
      age: "年龄", neutered: "结扎", allergies: "过敏原",
      young: (s) => `建议选择${s}专用饲料，此阶段的蛋白质与热量需求较高。`,
      adult: (s) => `建议选择${s}维持期饲料，维持稳定的体态即可。`,
      senior: "已进入熟龄阶段，建议选择熟龄专用配方，并留意关节与肾脏保健。",
      neuteredV: "结扎后代谢率下降约 20%，建议改用低脂或体重管理配方。",
      allergyV: (list) => `请避开含有 ${list} 的成分，可考虑单一蛋白质来源配方。`,
    },
    reasons: {
      stageExact: (s) => `${s}专用，营养比例刚好。`,
      stageAll: "全龄都能吃。",
      noAllergen: (list) => `不含${list}。`,
      single: (p) => `只用一种肉（${p}），过敏体质比较安心。`,
      neuteredWeight: "低热量配方，结扎后不容易胖。",
      neuteredWarn: "不是减重配方，结扎后请少喂一点。",
      seniorJoint: "有加关节保健成分。",
      seniorWarn: "没有关节保健成分。",
      small: (w) => `颗粒小，${w} 公斤的小型犬好咬。`,
      large: (w) => `${w} 公斤的大型犬，这款有控制钙磷，骨头负担小。`,
    },
    tags: { weight: "体重管理", highProtein: "高蛋白", single: "单一蛋白", joint: "关节保健", small: "小型犬", large: "大型犬", grainFree: "无谷" },
    care: {
      k: { exercise: "运动", grooming: "美容", health: "健康", home: "环境", social: "社交" },
      dog: {
        exPuppy: "幼犬骨头还在长，散步短一点、次数多一点：每大一个月，每次多 5 分钟。别跳高、别跑远。",
        exSmall: "每天散步 30 分钟左右，加一点在家玩就够。",
        exMedium: "每天动 45–60 分钟。散步之外闻闻东西、捡捡球，牠会更安定。",
        exLarge: "每天至少 60 分钟，分两次。夏天挑早晚，地面太烫别走。",
        exSenior: "每天短短散步就好，但别停。少爬楼梯、少跳沙发，地板铺防滑垫。",
        grPoodle: "卷毛要天天梳，一个多月修一次，不然会打结。",
        grSpitz: "每周梳 2–3 次，换毛季天天梳。不要剃毛。",
        grRetriever: "每周梳 1–2 次。垂耳要常检查、保持干燥。",
        grShepherd: "每周梳 2 次，掉毛多。留意脚掌磨损。",
        grFrenchie: "脸上皱褶每天擦干净。鼻子短容易热，夏天中午别出门。",
        grLong: "腰长腿短，别让牠跳上跳下，体重顾好。",
        grSchnauzer: "吃完擦胡子。一个多月修一次毛。",
        grToy: "天天梳毛、擦眼睛。冬天保暖，夏天别晒太久。",
        grMix: "短毛每周梳一次，长毛天天梳。顺便看看耳朵、指甲、牙齿。",
        hpPuppy: "疫苗从 6–8 周开始，打完 16 周那剂之前别去狗公园。驱虫照兽医排程。",
        hpAdult: "一年健检一次。常刷牙，牙结石最常见。",
        hpSenior: "7 岁后半年检查一次，顺便验血。体重、喝水、走路有变就早点看医生。",
        hpNeutered: "结扎后容易胖，每月量体重，肋骨要摸得到。",
        hpAllergy: (list) => `对${list}过敏：买东西先看成分，餐桌食物不给。会痒、耳朵发炎、拉肚子通常就是过敏。`,
        home: "给牠一个固定的安静角落。每天 10 分钟闻闻游戏或简单训练，比较不会乱咬东西。",
        soPuppy: "3–14 周多接触人、声音、不同地面和温和的成犬，每次短短的、开心的。",
        soAdult: "第一次见面先牵绳、在外面见。看到僵住或低吼就分开。",
        soIntactMale: "未结扎公犬遇到未结扎公犬容易起冲突，第一次见面多留意。",
      },
      cat: {
        exKitten: "幼猫精力多，一天多玩几次逗猫棒，每次 10 分钟。咬人就换成玩具。",
        exAdult: "每天两次逗猫棒，每次 10–15 分钟，让牠追、扑、抓到。玩完再喂。",
        exSenior: "还是要玩，但慢一点、在地上玩。跳台降低或加一阶。",
        grFluffy: "长毛天天梳，腋下、肚子、大腿内侧最会打结。",
        grShorthair: "短毛每周梳一次，换毛季多梳。顺便看皮肤。",
        grSphynx: "没毛的皮肤会出油，每周擦一次或洗澡。怕冷也怕晒。",
        grFold: "耳朵每周清。折耳猫天生软骨弱，走路怪怪的就看医生。",
        grMunchkin: "腿短别从高处跳，跳台要低阶梯。体重顾好。",
        hpKitten: "疫苗从 8 周开始，打完前待在家里。驱虫照兽医排程。",
        hpAdult: "一年健检一次。多给湿食或加水，泌尿问题少很多。",
        hpSenior: "7 岁后半年检查一次，重点是肾和甲状腺。喝很多水、变瘦要注意。",
        hpNeutered: "结扎后热量少 20–30%，用量杯喂、每月量体重。",
        hpAllergy: (list) => `对${list}过敏：零食主食都看成分。脖子脸部抓痒、拉肚子通常就是过敏。`,
        home: "猫砂盆比猫多一个。要有跳台或窗台、一个能躲的地方。磨爪板放牠常走的路上。",
        soGeneral: "猫不需要交朋友，你就是牠最好的玩伴。",
        soKitten: "想养第二只，1 岁前最容易接受，但还是要分房慢慢介绍。",
        soAdult: "成猫接受新猫要几周到几个月，个性合不合比年龄重要。",
        soSenior: "老猫喜欢安静，别找活泼幼猫来吵牠。",
      },
      sources: "参考 AAHA、WSAVA、AVSAB、International Cat Care 的指引。一般建议，有状况请问兽医。",
    },
    mates: {
      btn: "寻找附近的玩伴",
      nav: "PLAYMATES",
      title: (n) => `为 ${n} 寻找附近的玩伴`,
      intro: (city, sp) => `列出同样在${city}、也是${sp}的其他宠物，依年龄阶段、体型、结扎状态挑出最合适的一位。`,
      noCity: "还没设定所在城市。到「编辑」把城市填上，就能找同城的玩伴。",
      loading: "寻找中…",
      none: (city) => `${city}目前还没有其他宠物登记。`,
      best: "最佳配对",
      why: "配对理由",
      contact: "主人 Email",
      noEmail: "主人没有留 Email",
      catNote: "猫是领域性动物，不建议直接见面；这里的配对比较适合用来和饲主交流养猫经验。",
      fail: "读取失败，请稍后再试。",
      r: {
        sameStage: (s) => `年龄阶段相同，都是${s}`,
        nearStage: "年龄阶段相近",
        sizeClose: (a, b) => `体型相近（${a} 与 ${b} 公斤）`,
        sizeOk: "体型差距在可接受范围",
        sizeUnknown: "有一方体重未填，无法比对体型",
        bothNeutered: "都已结扎，互动通常较稳定",
        intactMales: "两只都是未结扎公犬，初次见面要特别留意",
        only: "目前同城只有这一位",
      },
    },
    check: {
      nav: "CHECK",
      title: (n) => `帮 ${n} 检查一款商品`,
      criteria: "先提供商品资讯（拍照、条码或手动），再让 AI 综合牠的资料判断。",
      petLine: (stage, allergies) => `牠现在是${stage}，过敏原：${allergies}`,
      tier0: "① 拍摄商品外观",
      tier0d: "拍下包装正面（品牌、名称清楚）。AI 辨识商品、查成分，再综合牠的资料判断。",
      takeFront: "拍商品",
      pickFront: "从相簿选择",
      identifying: "AI 处理中…",
      waitHint: "辨识商品并综合判断，约 5–15 秒。",
      photoFail: "辨识失败。请换一张更清楚的照片，或改用下面的方式。",
      aiTitle: "AI 综合判断",
      aiVerdict: { ok: "合适", bad: "不合适", unsure: "不确定" },
      aiConf: (c) => `辨识把握：${c}`,
      conf: { high: "高", medium: "中", low: "低" },
      aiSources: "参考来源",
      judgeBtn: "让 AI 综合判断这款商品",
      judging: "AI 判断中…",
      judgeHint: "参考你提供的名称、成分与年龄段。约 5–15 秒。",
      judgeFail: "AI 判断失败，请稍后再试。",
      verifyBtn: "让 AI 上网查证",
      verifying: "查证中…",
      verifyHint: "AI 不太确定时才需要；会多花一点时间与费用。",
      aiNote: "AI 判断可能有误，有疑虑请问兽医。",
      tier1: "② 输入条码",
      tier1d: "输入包装上的条码数字（通常 13 码），查询 Open Pet Food Facts。",
      barcodePh: "4712345678901",
      lookup: "查询",
      scan: "拍条码",
      scanning: "辨识条码中…",
      scanAI: "条码不清楚，改由 AI 读数字…",
      scanFail: "照片里读不到条码，请手动输入数字。拍的时候让条码占满画面、对焦清楚、避免反光。",
      scanByAI: "这串数字是 AI 从照片上读的，请和包装核对。",
      scanHint: "手机拍下包装上的条码即可，iPhone 与 Android 都支援。",
      searching: "查询中…",
      notFound: "资料库里没有这个条码。请改用下面的方式。",
      netError: "无法连线到资料库（预览环境可能限制对外连线，正式版不会）。请改用下面的方式。",
      opffNote: "资料来源：Open Pet Food Facts（开源社群资料库）。目前仅比对此资料库，收录量有限，亚洲市场商品常查不到。",
      tier3: "③ 手动输入",
      tier3d: "查不到时，直接照包装上的成分表点选或输入。",
      manualStart: "开始手动输入",
      productTitle: "商品资讯",
      nameLabel: "商品名称",
      ingLabel: "成分（可修改）",
      pickIng: "常见成分（点选，可多选）",
      extraIng: "其他成分（选单里没有的，直接抄包装）",
      pickedPreview: (t) => `会用来比对的成分：${t}`,
      ingPh: "chicken, brown rice, …",
      stageLabel: "商品适用年龄段",
      stages: { young: "幼年", adult: "成年", senior: "熟龄", all: "全龄", unknown: "不确定" },
      sourceLabel: "来源：",
      sources: { photo: "AI 辨识照片＋网络查询（请核对）", opff: "Open Pet Food Facts", manual: "手动输入" },
      clear: "清除重来",
      resultTitle: "快速比对（AI 判断前）",
      verdict: { bad: "不建议", ok: "可以考虑", stageMismatch: "年龄段不符", stageUnknown: "过敏原没问题，年龄段不确定" },
      allergenHit: (list) => `含有牠的过敏原：${list}`,
      allergenNone: "没有发现牠的过敏原",
      petNoAllergy: "牠没有登记过敏原，所以第一项无法比对。想比对请先在资料里填上。",
      stageOk: (p) => `年龄段相符（${p}）`,
      stageAll: "全龄配方，年龄段没问题",
      stageBad: (prod, pet) => `年龄段不符：商品是${prod}用，牠是${pet}`,
      stageUnk: "无法从资料判断年龄段，请看包装确认",
      resultNote: "只看过敏原与年龄段两项。慢性病、处方需求请问兽医。",
    },
    form: {
      newLabel: "NEW", editLabel: "EDIT", reqNote: "＊ 必填",
      photo: "照片", takePhoto: "拍照", fromGallery: "从相簿选择", removePhoto: "移除照片",
      photoHint: "照片上限 8 MB。",
      name: "名字", namePh: "小白",
      species: "物种", dog: "犬", cat: "猫",
      breed: "品种", pick: "请选择", breedOtherPh: "请输入品种",
      gender: "性别", male: "公", female: "母",
      birthday: "生日", birthdayHint: "不确定的话填领养日期就好，之后可以改。",
      weight: "体重（公斤）", weightHint: "拉到大概的位置，再用 −／＋ 微调。不清楚可以先不填。", weightClear: "清除",
      neutered: "结扎状态", yes: "已结扎", no: "未结扎",
      allergies: "已知过敏原",
      allergiesHint: "点选所有已知的过敏原，没有就不用选。",
      city: "所在城市", cityHint: "之后找玩伴、揪团、附近诊所都会用到。",
      ownerEmail: "主人 Email", ownerEmailHint: "选填。之后联络与找回资料会用到。", errEmail: "Email 格式看起来不对，请确认。",
      note: "备注", notePh: "怕打雷、不能吃太快",
      errName: "请填写名字。",
      errBirthday: "请填写生日，年龄与饲料建议需要用到。",
      errFuture: "生日不能是未来的日期。",
      errPhoto: "这张图片读不进来，换一张试试。",
      guess: "让 AI 辨识物种与品种",
      guessAgain: "重新辨识",
      guessing: "AI 辨识中…",
      guessDone: (sp, br) => `AI 已自动填写：${sp}${br ? `・${br}` : ""}`,
      guessNone: "AI 无法辨识，请自行选择。",
      guessFail: "辨识失败，请自行选择。",
      conf: { high: "高", medium: "中", low: "低" },
      save: "储存修改", issue: "贴进手帐", cancel: "取消",
    },
  },

  en: {
    title: "Pet Journal",
    sub: "宠物手帐",
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
      loadFail: "Couldn't load your data. Please refresh and try again.",
    },
    issued: (n) => `${n} family member${n === 1 ? "" : "s"}`,
    notIssued: "No family members yet",
    stats: (o, p) => `${o} owner${o === 1 ? "" : "s"} have joined this pet world, with ${p} pet${p === 1 ? "" : "s"}`,
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
    speciesName: { dog: "Dog", cat: "Cat" },
    rows: {
      species: "Species", gender: "Sex", birthday: "Date of birth", weight: "Weight", neutered: "Neutered",
      allergies: "Allergies", city: "City", ownerEmail: "Owner email", note: "Notes",
    },
    gender: { male: "Male", female: "Female" },
    neuteredYes: "Yes",
    neuteredNo: "No",
    noAllergy: "None",
    annex1: "Nutrition profile",
    annex2: "Recommended products",
    annex3: "Care guide",
    checkBtn: "Check if a product suits them",
    noProducts: "Nothing in the current catalogue avoids all listed allergens and fits this life stage. Talk to your vet or consider a prescription diet.",
    ingredientsLabel: "Main ingredients: ",
    whyFor: (n) => `Why it suits ${n}`,
    watchOut: "Keep in mind",
    disclaimer: "Sample products for demonstration. Suggestions are a guide only; ask your vet.",
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
      stageExact: (s) => `Made for ${s}.`,
      stageAll: "Suitable for all ages.",
      noAllergen: (list) => `No ${list} inside.`,
      single: (p) => `One meat only (${p}), safer for allergies.`,
      neuteredWeight: "Low-calorie, so a neutered pet stays trim.",
      neuteredWarn: "Not a weight-control formula; feed a bit less after neutering.",
      seniorJoint: "Includes joint support.",
      seniorWarn: "No joint support included.",
      small: (w) => `Small kibble, easy for a ${w} kg dog to chew.`,
      large: (w) => `Balanced minerals for a ${w} kg dog's bones.`,
    },
    tags: { weight: "Weight control", highProtein: "High protein", single: "Single protein", joint: "Joint care", small: "Small breed", large: "Large breed", grainFree: "Grain-free" },
    care: {
      k: { exercise: "Exercise", grooming: "Grooming", health: "Health", home: "Home", social: "Social" },
      dog: {
        exPuppy: "Puppy bones are still growing: short walks, more often. Add 5 minutes per month of age. No jumping, no long runs.",
        exSmall: "About 30 minutes of walking a day plus some play at home is enough.",
        exMedium: "45–60 minutes a day. Add sniffing and fetch to the walk; it settles them.",
        exLarge: "At least 60 minutes a day, split in two. Summer: early or late, and skip hot pavement.",
        exSenior: "A short walk every day, but don't stop. Fewer stairs, no sofa jumping, non-slip mats on the floor.",
        grPoodle: "Curly coat: brush daily, clip every 4–6 weeks or it mats.",
        grSpitz: "Brush 2–3 times a week, daily when shedding. Never shave.",
        grRetriever: "Brush 1–2 times a week. Check floppy ears often and keep them dry.",
        grShepherd: "Brush twice a week; lots of shedding. Watch the paw pads.",
        grFrenchie: "Wipe the face folds clean every day. Short nose overheats: no midday walks in summer.",
        grLong: "Long back, short legs: no jumping on or off things, and keep weight down.",
        grSchnauzer: "Wipe the beard after meals. Clip every 6–8 weeks.",
        grToy: "Brush daily and wipe the eyes. Keep warm in winter, out of long sun in summer.",
        grMix: "Short coat: brush weekly. Long coat: daily. Check ears, nails and teeth while you're at it.",
        hpPuppy: "Vaccines start at 6–8 weeks; no dog parks until the 16-week dose is done. Deworm on your vet's schedule.",
        hpAdult: "A check-up once a year. Brush teeth often; tartar is the most common problem.",
        hpSenior: "From age 7, a check-up every six months with blood tests. Changes in weight, drinking or walking: see the vet early.",
        hpNeutered: "Weight creeps up after neutering. Weigh monthly; you should feel the ribs.",
        hpAllergy: (list) => `Allergic to ${list}: read ingredients before buying, no table scraps. Itching, ear infections and loose stools usually mean allergy.`,
        home: "Give them a fixed quiet corner. Ten minutes of sniffing games or simple training a day means less chewing.",
        soPuppy: "At 3–14 weeks, meet lots of people, sounds, surfaces and gentle adult dogs. Keep it short and happy.",
        soAdult: "First meetings on lead, outside. Separate at the first stiff posture or low growl.",
        soIntactMale: "Intact males tend to clash with other intact males. Take extra care at the first meeting.",
      },
      cat: {
        exKitten: "Kittens have lots of energy: several wand-toy sessions a day, 10 minutes each. Biting hands? Swap in a toy.",
        exAdult: "Wand toy twice a day, 10–15 minutes: chase, pounce, catch. Feed afterwards.",
        exSenior: "Still play, but slower and on the ground. Lower the cat tree or add a step.",
        grFluffy: "Long coat: brush daily. Armpits, belly and inner thighs mat first.",
        grShorthair: "Short coat: brush weekly, more when shedding. Check the skin too.",
        grSphynx: "Hairless skin gets oily: wipe or bathe weekly. Feels both cold and sun.",
        grFold: "Clean the ears weekly. Folds have weak cartilage; odd walking means a vet visit.",
        grMunchkin: "Short legs: no jumping from heights, low steps on the cat tree. Keep weight down.",
        hpKitten: "Vaccines start at 8 weeks; stay indoors until done. Deworm on your vet's schedule.",
        hpAdult: "A check-up once a year. Wet food or added water means far fewer urinary problems.",
        hpSenior: "From age 7, a check-up every six months, mainly kidneys and thyroid. Drinking a lot or losing weight: watch out.",
        hpNeutered: "Needs 20–30% fewer calories after neutering. Measure food, weigh monthly.",
        hpAllergy: (list) => `Allergic to ${list}: read ingredients on treats and food. Scratching the neck and face, or loose stools, usually means allergy.`,
        home: "One more litter box than cats. A cat tree or window perch and a hiding spot. Scratching post on their usual route.",
        soGeneral: "Cats don't need friends; you're their best playmate.",
        soKitten: "Thinking of a second cat? Before age 1 is easiest, but still introduce slowly in separate rooms.",
        soAdult: "An adult takes weeks to months to accept a new cat. Personality matters more than age.",
        soSenior: "Old cats like it quiet; don't bring in a lively kitten to bother them.",
      },
      sources: "Based on AAHA, WSAVA, AVSAB and International Cat Care guidelines. General advice; ask your vet if anything seems off.",
    },
    mates: {
      btn: "Find playmates nearby",
      nav: "PLAYMATES",
      title: (n) => `Playmates near ${n}`,
      intro: (city, sp) => `Other ${sp} registered in ${city}, with the best match picked by life stage, size and neuter status.`,
      noCity: "No city set yet. Tap Edit and choose a city to find playmates nearby.",
      loading: "Looking…",
      none: (city) => `No other pets are registered in ${city} yet.`,
      best: "Best match",
      why: "Why this match",
      contact: "Owner email",
      noEmail: "The owner didn't leave an email",
      catNote: "Cats are territorial and direct meetings aren't recommended; use this match to swap cat-care tips with the owner instead.",
      fail: "Couldn't load. Please try again later.",
      r: {
        sameStage: (s) => `Same life stage: both ${s}`,
        nearStage: "Neighbouring life stages",
        sizeClose: (a, b) => `Similar size (${a} vs ${b} kg)`,
        sizeOk: "Size difference is within a reasonable range",
        sizeUnknown: "One weight is missing, so size can't be compared",
        bothNeutered: "Both neutered, which usually makes play calmer",
        intactMales: "Both are intact males; take extra care at the first meeting",
        only: "The only other one in this city right now",
      },
    },
    check: {
      nav: "CHECK",
      title: (n) => `Check a product for ${n}`,
      criteria: "Provide the product (photo, barcode or manual entry), then let AI judge it against the whole profile.",
      petLine: (stage, allergies) => `They are ${stage}. Allergies: ${allergies}`,
      tier0: "① Photo of the product",
      tier0d: "Photograph the front of the pack (brand and name visible). AI identifies it, finds the ingredients and judges against this pet.",
      takeFront: "Photograph product",
      pickFront: "Choose from library",
      identifying: "AI is working…",
      waitHint: "Identifying the product and judging. About 5–15 seconds.",
      photoFail: "Couldn't identify it. Try a clearer photo, or use one of the options below.",
      aiTitle: "AI verdict",
      aiVerdict: { ok: "Suitable", bad: "Not suitable", unsure: "Unsure" },
      aiConf: (c) => `Identification confidence: ${c}`,
      conf: { high: "high", medium: "medium", low: "low" },
      aiSources: "Sources",
      judgeBtn: "Let AI judge this product",
      judging: "AI is judging…",
      judgeHint: "Uses the name, ingredients and life stage you provided. About 5–15 seconds.",
      judgeFail: "AI couldn't judge it. Please try again later.",
      verifyBtn: "Let AI verify online",
      verifying: "Verifying…",
      verifyHint: "Only needed when AI isn't sure; takes a little longer and costs a bit more.",
      aiNote: "AI can be wrong; ask your vet if in doubt.",
      tier1: "② Enter barcode",
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
      tier3: "③ Enter manually",
      tier3d: "If the lookup fails, tap or type the ingredients from the pack.",
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
      sources: { photo: "AI photo ID + web lookup (please verify)", opff: "Open Pet Food Facts", manual: "Entered manually" },
      clear: "Start over",
      resultTitle: "Quick check (before AI)",
      verdict: { bad: "Not recommended", ok: "Worth considering", stageMismatch: "Life stage mismatch", stageUnknown: "Allergens OK, life stage unclear" },
      allergenHit: (list) => `Contains their allergens: ${list}`,
      allergenNone: "None of their allergens found",
      petNoAllergy: "No allergies are recorded for them, so the first check can't run. Add allergies to their profile to enable it.",
      stageOk: (p) => `Life stage matches (${p})`,
      stageAll: "All-life-stage formula, so the stage is fine",
      stageBad: (prod, pet) => `Life stage mismatch: the pack is for ${prod}, they are ${pet}`,
      stageUnk: "Couldn't determine the life stage from the data; check the pack",
      resultNote: "Checks allergens and life stage only. For chronic conditions or prescription needs, ask your vet.",
    },
    form: {
      newLabel: "NEW", editLabel: "EDIT", reqNote: "* Required",
      photo: "Photo", takePhoto: "Take photo", fromGallery: "Choose from library", removePhoto: "Remove photo",
      photoHint: "Photos up to 8 MB.",
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
      ownerEmail: "Owner email", ownerEmailHint: "Optional. Used later for contact and account recovery.", errEmail: "That email doesn't look right. Please check it.",
      note: "Notes", notePh: "Scared of thunder, eats too fast",
      errName: "Please enter a name.",
      errBirthday: "Please enter a date of birth. Age and food advice depend on it.",
      errFuture: "Date of birth can't be in the future.",
      errPhoto: "That image couldn't be read. Try another one.",
      guess: "Let AI identify the species and breed",
      guessAgain: "Identify again",
      guessing: "AI is looking…",
      guessDone: (sp, br) => `Filled in by AI: ${sp}${br ? ` · ${br}` : ""}`,
      guessNone: "AI couldn't identify it. Please choose.",
      guessFail: "Couldn't recognise the photo. Please choose.",
      conf: { high: "high", medium: "medium", low: "low" },
      save: "Save changes", issue: "Add to journal", cancel: "Cancel",
    },
  },
};

const LangCtx = createContext({ lang: "en", L: STR.en, setLang: () => {} });
const useL = () => useContext(LangCtx);

/* ==================================================================
   资料字典
================================================================== */

const BREEDS = {
  dog: {
    mix: ["米克斯", "Mixed breed"], shiba: ["柴犬", "Shiba Inu"], poodle: ["贵宾犬", "Poodle"],
    corgi: ["柯基", "Corgi"], frenchie: ["法国斗牛犬", "French Bulldog"], pom: ["博美", "Pomeranian"],
    maltese: ["马尔济斯", "Maltese"], chihuahua: ["吉娃娃", "Chihuahua"], dachshund: ["腊肠犬", "Dachshund"],
    shihtzu: ["西施犬", "Shih Tzu"], yorkie: ["约克夏", "Yorkshire Terrier"], schnauzer: ["雪纳瑞", "Schnauzer"],
    bichon: ["比熊", "Bichon Frise"], husky: ["哈士奇", "Siberian Husky"], golden: ["黄金猎犬", "Golden Retriever"],
    lab: ["拉布拉多", "Labrador Retriever"], border: ["边境牧羊犬", "Border Collie"], gsd: ["德国牧羊犬", "German Shepherd"],
    akita: ["秋田犬", "Akita"], samoyed: ["萨摩耶", "Samoyed"], taiwan: ["台湾犬", "Taiwan Dog"],
    other: ["其他", "Other"],
  },
  cat: {
    mix: ["米克斯", "Mixed breed"], ash: ["美国短毛猫", "American Shorthair"], bsh: ["英国短毛猫", "British Shorthair"],
    ragdoll: ["布偶猫", "Ragdoll"], persian: ["波斯猫", "Persian"], fold: ["苏格兰折耳猫", "Scottish Fold"],
    munchkin: ["曼赤肯", "Munchkin"], siamese: ["暹罗猫", "Siamese"], bengal: ["孟加拉猫", "Bengal"],
    maine: ["缅因猫", "Maine Coon"], russian: ["俄罗斯蓝猫", "Russian Blue"], aby: ["阿比西尼亚猫", "Abyssinian"],
    norwegian: ["挪威森林猫", "Norwegian Forest Cat"], sphynx: ["斯芬克斯", "Sphynx"], exotic: ["异国短毛猫", "Exotic Shorthair"],
    other: ["其他", "Other"],
  },
};

/* 城市：存代码，显示时翻译 */
const CITIES = {
  singapore: ["新加坡", "Singapore", "🇸🇬"],
  fontainebleau: ["枫丹白露", "Fontainebleau", "🇫🇷"],
  abuDhabi: ["阿布达比", "Abu Dhabi", "🇦🇪"],
  other: ["其他", "Other", "🌍"],
};
/* 显示用：国旗 + 城市名，例如「🇸🇬 新加坡」 */
const cityLabel = (k, lang) => (CITIES[k] ? `${CITIES[k][2]} ${CITIES[k][li(lang)]}` : k || "");

const ING = {
  chicken: ["鸡肉", "Chicken"], brownRice: ["糙米", "Brown rice"], oats: ["燕麦", "Oats"],
  chickenFat: ["鸡脂", "Chicken fat"], fishOil: ["鱼油", "Fish oil"], barley: ["大麦", "Barley"],
  calcium: ["碳酸钙", "Calcium carbonate"], lamb: ["羊肉", "Lamb"], sweetPotato: ["地瓜", "Sweet potato"],
  peas: ["豌豆", "Peas"], flaxseed: ["亚麻籽", "Flaxseed"], turkey: ["火鸡肉", "Turkey"],
  cellulose: ["纤维素", "Cellulose"], peaProtein: ["豌豆蛋白", "Pea protein"], salmon: ["鲑鱼", "Salmon"],
  chickpeas: ["鹰嘴豆", "Chickpeas"], lentils: ["扁豆", "Lentils"], duck: ["鸭肉", "Duck"],
  pumpkin: ["南瓜", "Pumpkin"], glucosamine: ["葡萄糖胺", "Glucosamine"], chondroitin: ["软骨素", "Chondroitin"],
  whitefish: ["白鱼", "Whitefish"], chickenLiver: ["鸡肝", "Chicken liver"], tuna: ["鲔鱼", "Tuna"],
  venison: ["鹿肉", "Venison"], herring: ["鲱鱼", "Herring"],
};

/* 没有照片时的剪影。依「体型类型」分 15 种，不是逐一品种写实，但同一类型的品种共用一张 */
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
  bluecrest: ["Bluecrest", "Bluecrest"], nekono: ["猫野", "Nekono"],
};

const CATALOG = [
  { id: "d01", brand: "yehara", name: ["幼犬 鸡肉糙米配方", "Puppy Chicken & Brown Rice"], species: "dog", stage: "young", size: "2 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "oats", "chickenFat", "fishOil"], tags: [] },
  { id: "d02", brand: "yehara", name: ["大型幼犬 骨骼发育配方", "Large Breed Puppy Bone Support"], species: "dog", stage: "young", size: "6 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "barley", "fishOil", "calcium"], tags: ["large"] },
  { id: "d03", brand: "yehara", name: ["小型成犬 小颗粒配方", "Small Breed Adult Mini Kibble"], species: "dog", stage: "adult", size: "1.5 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "oats", "chickenFat"], tags: ["small"] },
  { id: "d04", brand: "yehara", name: ["成犬 羊肉地瓜配方", "Adult Lamb & Sweet Potato"], species: "dog", stage: "adult", size: "2 kg", protein: "lamb", ingredients: ["lamb", "sweetPotato", "peas", "flaxseed"], tags: ["single", "grainFree"] },
  { id: "d05", brand: "northfield", name: ["成犬 体重管理配方", "Adult Weight Control"], species: "dog", stage: "adult", size: "3 kg", protein: "turkey", ingredients: ["turkey", "barley", "cellulose", "peaProtein"], tags: ["weight"] },
  { id: "d06", brand: "bluecrest", name: ["运动犬 高蛋白鲑鱼配方", "Active Dog High-Protein Salmon"], species: "dog", stage: "adult", size: "2 kg", protein: "salmon", ingredients: ["salmon", "chicken", "chickpeas", "lentils"], tags: ["highProtein", "grainFree"] },
  { id: "d07", brand: "bluecrest", name: ["全龄犬 鸭肉单一蛋白", "All Life Stages Duck Single Protein"], species: "dog", stage: "all", size: "2 kg", protein: "duck", ingredients: ["duck", "sweetPotato", "peas", "pumpkin"], tags: ["single", "grainFree"] },
  { id: "d08", brand: "northfield", name: ["熟龄犬 关节保健配方", "Senior Joint Care"], species: "dog", stage: "senior", size: "3 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "glucosamine", "chondroitin", "fishOil"], tags: ["joint"] },
  { id: "d09", brand: "northfield", name: ["熟龄犬 低脂白鱼配方", "Senior Low-Fat Whitefish"], species: "dog", stage: "senior", size: "2 kg", protein: "whitefish", ingredients: ["whitefish", "brownRice", "cellulose", "glucosamine"], tags: ["weight", "joint", "single"] },
  { id: "c01", brand: "nekono", name: ["幼猫 鸡肉配方", "Kitten Chicken"], species: "cat", stage: "young", size: "1.5 kg", protein: "chicken", ingredients: ["chicken", "chickenLiver", "brownRice", "fishOil"], tags: [] },
  { id: "c02", brand: "nekono", name: ["成猫 鲔鱼鸡肉配方", "Adult Tuna & Chicken"], species: "cat", stage: "adult", size: "2 kg", protein: "tuna", ingredients: ["tuna", "chicken", "brownRice", "fishOil"], tags: [] },
  { id: "c03", brand: "nekono", name: ["结扎猫 体重管理配方", "Neutered Cat Weight Control"], species: "cat", stage: "adult", size: "2 kg", protein: "chicken", ingredients: ["chicken", "barley", "cellulose", "peaProtein"], tags: ["weight"] },
  { id: "c04", brand: "bluecrest", name: ["全龄猫 鹿肉单一蛋白", "All Life Stages Venison Single Protein"], species: "cat", stage: "all", size: "1.5 kg", protein: "venison", ingredients: ["venison", "peas", "sweetPotato", "pumpkin"], tags: ["single", "grainFree"] },
  { id: "c05", brand: "bluecrest", name: ["活力猫 高蛋白鲑鱼配方", "Active Cat High-Protein Salmon"], species: "cat", stage: "adult", size: "1.5 kg", protein: "salmon", ingredients: ["salmon", "herring", "chickpeas", "lentils"], tags: ["highProtein", "grainFree"] },
  { id: "c06", brand: "northfield", name: ["熟龄猫 关节肾脏配方", "Senior Joint & Kidney Support"], species: "cat", stage: "senior", size: "2 kg", protein: "chicken", ingredients: ["chicken", "brownRice", "glucosamine", "fishOil"], tags: ["joint"] },
  { id: "c07", brand: "northfield", name: ["熟龄猫 低脂白鱼配方", "Senior Low-Fat Whitefish"], species: "cat", stage: "senior", size: "1.5 kg", protein: "whitefish", ingredients: ["whitefish", "brownRice", "cellulose", "glucosamine"], tags: ["weight", "joint", "single"] },
];

/* 过敏原：固定选项。key 存进资料、label 用来显示、terms 用来比对成分表 */
const ALLERGENS = {
  chicken: { label: ["鸡肉", "Chicken"], terms: ["chicken", "雞", "鸡", "poultry"] },
  beef:    { label: ["牛肉", "Beef"],    terms: ["beef", "牛肉"] },
  pork:    { label: ["猪肉", "Pork"],    terms: ["pork", "豬肉", "猪肉", "豬", "猪"] },
  lamb:    { label: ["羊肉", "Lamb"],    terms: ["lamb", "mutton", "羊肉", "羊"] },
  fish:    { label: ["鱼类", "Fish"],    terms: ["fish", "魚", "鱼", "salmon", "鮭", "tuna", "鮪", "herring", "鯡", "cod", "鱈", "sardine", "anchovy"] },
  salmon:  { label: ["鲑鱼", "Salmon"],  terms: ["salmon", "鮭", "鲑"] },
  tuna:    { label: ["鲔鱼", "Tuna"],    terms: ["tuna", "鮪", "金槍魚"] },
  duck:    { label: ["鸭肉", "Duck"],    terms: ["duck", "鴨", "鸭"] },
  turkey:  { label: ["火鸡肉", "Turkey"], terms: ["turkey", "火雞", "火鸡"] },
  egg:     { label: ["蛋", "Egg"],       terms: ["egg", "雞蛋", "鸡蛋", "蛋黃", "蛋粉", "全蛋"] },
  dairy:   { label: ["乳制品", "Dairy"], terms: ["dairy", "milk", "cheese", "whey", "lactose", "牛奶", "奶粉", "乳清", "起司", "乳酪"] },
  wheat:   { label: ["小麦", "Wheat"],   terms: ["wheat", "gluten", "小麥", "小麦", "麩質"] },
  corn:    { label: ["玉米", "Corn"],    terms: ["corn", "maize", "玉米"] },
  soy:     { label: ["大豆", "Soy"],     terms: ["soy", "soya", "soybean", "大豆", "黃豆", "黄豆"] },
  rice:    { label: ["米", "Rice"],      terms: ["rice", "大米", "白米", "糙米", "米飯"] },
  peanut:  { label: ["花生", "Peanut"],  terms: ["peanut", "花生"] },
};
const ALLERGEN_KEYS = Object.keys(ALLERGENS);

/* 手动输入成分时的点选清单：先列 16 个过敏原（比对真正在乎的），再列常见的其他成分 */
const MANUAL_ING = [
  ...ALLERGEN_KEYS.map((k) => ({ key: "a:" + k, label: ALLERGENS[k].label, term: ALLERGENS[k].terms[0] })),
  ...["brownRice", "oats", "barley", "sweetPotato", "peas", "chickpeas", "lentils", "pumpkin", "flaxseed", "fishOil", "chickenFat", "chickenLiver", "venison", "whitefish", "herring", "glucosamine"]
    .map((k) => ({ key: "i:" + k, label: ING[k], term: ING[k][1].toLowerCase() })),
];
/* 点选的 + 手打的 → 一段文字，交给 checkProduct 比对 */
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

/* 把过敏原 key 展开成一组比对用的词；旧资料若是自由文字，模糊对应到最接近的选项 */
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

/* 商品目录的成分是否含某过敏原 */
function ingredientMatches(ingKey, allergen) {
  const [zh, en] = ING[ingKey] || [ingKey, ingKey];
  const hay = (zh + " " + en).toLowerCase();
  return expandAllergen(allergen).some((t) => hay.includes(t));
}

/* 从商品名称或分类文字推测年龄段 */
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
  return results.slice(0, 1);
}

/* 养育建议：依物种、月龄、体型、品种体型类型、结扎、过敏原 */
function careAdvice(pet, L, lang) {
  const C = L.care;
  const K = C.k;
  const a = ageParts(pet.birthday);
  const months = a ? a.y * 12 + a.m : 36;
  const w = Number(pet.weightKg) || 0;
  const sil = silhouetteFor(pet.species, pet.breed);
  const out = [];
  const stage = months < 12 ? "young" : months <= 84 ? "adult" : "senior";
  const allergyText = pet.allergies?.length ? allergenList(pet.allergies, lang, L) : "";
  if (pet.species === "dog") {
    const D = C.dog;
    if (stage === "young") out.push({ k: K.exercise, v: D.exPuppy });
    else if (stage === "senior") out.push({ k: K.exercise, v: D.exSenior });
    else out.push({ k: K.exercise, v: w > 0 && w < 10 ? D.exSmall : w > 25 ? D.exLarge : D.exMedium });
    const G = { poodle: D.grPoodle, spitz: D.grSpitz, retriever: D.grRetriever, shepherd: D.grShepherd, frenchie: D.grFrenchie,
      dachshund: D.grLong, corgi: D.grLong, schnauzer: D.grSchnauzer, toy: D.grToy };
    out.push({ k: K.grooming, v: G[sil] || D.grMix });
    const hp = [stage === "young" ? D.hpPuppy : stage === "senior" ? D.hpSenior : D.hpAdult];
    if (pet.neutered) hp.push(D.hpNeutered);
    if (allergyText) hp.push(D.hpAllergy(allergyText));
    out.push({ k: K.health, v: hp.join(" ") });
    out.push({ k: K.home, v: D.home });
    const so = [stage === "young" ? D.soPuppy : D.soAdult];
    if (!pet.neutered && pet.gender === "male" && months >= 6) so.push(D.soIntactMale);
    out.push({ k: K.social, v: so.join(" ") });
  } else {
    const T = C.cat;
    out.push({ k: K.exercise, v: stage === "young" ? T.exKitten : stage === "senior" ? T.exSenior : T.exAdult });
    const G = { fluffy: T.grFluffy, sphynx: T.grSphynx, fold: T.grFold, munchkin: T.grMunchkin };
    out.push({ k: K.grooming, v: G[sil] || T.grShorthair });
    const hp = [stage === "young" ? T.hpKitten : stage === "senior" ? T.hpSenior : T.hpAdult];
    if (pet.neutered) hp.push(T.hpNeutered);
    if (allergyText) hp.push(T.hpAllergy(allergyText));
    out.push({ k: K.health, v: hp.join(" ") });
    out.push({ k: K.home, v: T.home });
    out.push({ k: K.social, v: [T.soGeneral, stage === "young" ? T.soKitten : stage === "senior" ? T.soSenior : T.soAdult].join(" ") });
  }
  return out;
}

/* ---- 玩伴配对：年龄阶段、体型、结扎 ----
   分数规则和资料库的 find_playmates() 完全相同，改一边要记得改另一边 */
function stageN(birthday) {
  const a = ageParts(birthday);
  const m = a ? a.y * 12 + a.m : 36;
  return m < 12 ? 0 : m <= 84 ? 1 : 2;
}
function playmateScore(me, o) {
  let s = 0;
  const sm = stageN(me.birthday), so = stageN(o.birthday);
  if (sm === so) s += 3; else if (Math.abs(sm - so) === 1) s += 1;
  const wm = Number(me.weightKg) || 0, wo = Number(o.weightKg) || 0;
  if (!wm || !wo) s += 1;
  else { const r = Math.max(wm, wo) / Math.min(wm, wo); if (r <= 1.5) s += 3; else if (r <= 2.5) s += 1; }
  if (me.neutered && o.neutered) s += 1;
  if (!me.neutered && !o.neutered && me.gender === "male" && o.gender === "male") s -= 2;
  return s;
}
function playmateReasons(me, o, L, onlyOne) {
  const R = L.mates.r;
  const out = [];
  const sm = stageN(me.birthday), so = stageN(o.birthday);
  const stageKey = ["young", "adult", "senior"][sm];
  if (sm === so) out.push(R.sameStage(L.stage[stageKey][me.species]));
  else if (Math.abs(sm - so) === 1) out.push(R.nearStage);
  const wm = Number(me.weightKg) || 0, wo = Number(o.weightKg) || 0;
  if (!wm || !wo) out.push(R.sizeUnknown);
  else { const r = Math.max(wm, wo) / Math.min(wm, wo); if (r <= 1.5) out.push(R.sizeClose(wm, wo)); else if (r <= 2.5) out.push(R.sizeOk); }
  if (me.neutered && o.neutered) out.push(R.bothNeutered);
  if (!me.neutered && !o.neutered && me.gender === "male" && o.gender === "male") out.push(R.intactMales);
  if (onlyOne) out.push(R.only);
  return out;
}

/* Netlify 版：交给资料库的 find_playmates()。它只回传同城、同物种、别人的宠物，
   而且只有最佳配对那一笔才附主人 Email，其他人的 Email 根本不会离开资料库。 */
async function loadPlaymates(pet) {
  const { data, error } = await supabase.rpc("find_playmates", { p_pet_id: pet.id });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, name: r.name, species: r.species, breed: r.breed || "", gender: r.gender || "", birthday: r.birthday || "",
    weightKg: r.weight_kg == null ? "" : Number(r.weight_kg), neutered: !!r.neutered, city: r.city || "", photo: r.photo || "",
    score: r.score, isMatch: !!r.is_match, ownerEmail: r.owner_email || "",
  }));
}

/* 全站统计：问资料库的 journal_stats()（不重复的 owner_id 数、宠物笔数），见 migrate-v5-stats.sql */
async function loadStats() {
  const { data, error } = await supabase.rpc("journal_stats");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { owners: Number(row?.owners || 0), pets: Number(row?.pets || 0) };
}

/* ---- 拍商品外观 → AI 辨识 + 上网查 + 判断 ---- */
const FOOD_SYSTEM = `You are the product-check assistant inside a pet journal app. The photo shows the outside of a pet food product (dog or cat food, treats, or supplements). Identify the exact product and judge whether it suits the specific pet described. Use web search to confirm the brand, product name and the official ingredient list when they are not fully readable in the photo. Be honest about uncertainty and never invent ingredients.`;

function buildFoodPrompt(pet, L, product, webSearch) {
  const a = ageParts(pet.birthday);
  const profile = {
    species: pet.species,
    breed: breedLabel(pet.species, pet.breed, "en") || "unknown",
    age_months: a ? a.y * 12 + a.m : null,
    life_stage: lifeStage(pet),
    weight_kg: Number(pet.weightKg) || null,
    neutered: !!pet.neutered,
    known_allergies: (pet.allergies || []).map((k) => (ALLERGENS[k] ? ALLERGENS[k].label[1] : k)),
  };
  const source = product
    ? `Product information entered by the owner (no photo): ${JSON.stringify({ name: product.name || null, ingredients: product.ingredients || null, life_stage_on_pack: product.stage || "unknown" })}
Treat the owner's ingredient list as authoritative when given.`
    : `The photo shows the outside of the product. Identify it: brand, product name, variant (e.g. "Adult Lamb & Rice"). Read the ingredient list and life stage from the label if visible; otherwise rely on what you already know about this product.`;
  const searchRule = webSearch
    ? "You may use web search, at most twice, only if you cannot determine the product's ingredients or life stage otherwise."
    : "Do not use any tools. If you cannot determine the ingredients from the photo or your own knowledge, answer \"unsure\" rather than guessing.";
  return `Pet profile: ${JSON.stringify(profile)}

${source}
${searchRule}

Decide suitability for THIS pet, considering everything you know (allergies, species, life stage, neuter status, weight, and general nutritional fit): "bad" if any ingredient matches one of the pet's known allergies, or the product is made for a clearly different species or life stage; "ok" if you have the ingredients and none of those problems apply; "unsure" if you could not identify the product or its ingredients.

Output exactly ONE fenced json block in this shape and nothing else, no explanation before or after:
\`\`\`json
{"product":{"name":"","brand":"","ingredients":["main ingredients, at most 15"],"stage":"young|adult|senior|all|unknown","confidence":"high|medium|low"},"verdict":"ok|bad|unsure","reasons":{"zh":"2-3 short sentences in Simplified Chinese addressed to the owner, naming the ingredient or stage behind the verdict and one practical note","en":"the same 2-3 sentences in English"},"sources":["https://..."]}
\`\`\``;
}

/* 从 AI 的回覆里把最后一段 JSON 挖出来 */
function extractJson(text) {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fenced.length) return JSON.parse(fenced[fenced.length - 1][1].trim());
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i >= 0 && j > i) return JSON.parse(text.slice(i, j + 1));
  throw new Error("no-json");
}

/* 共用：把 AI 回覆整理成 app 用的格式 */
function normalizeFoodResult(j) {
  const p = j.product || {};
  const ingredients = Array.isArray(p.ingredients) ? p.ingredients.join(", ") : String(p.ingredients || "");
  const stage = ["young", "adult", "senior", "all"].includes(p.stage) ? p.stage : inferStage(`${p.name || ""} ${ingredients}`);
  const r = j.reasons && typeof j.reasons === "object" ? j.reasons : { zh: String(j.reasons || ""), en: String(j.reasons || "") };
  return {
    name: [p.brand, p.name].filter(Boolean).join(" "),
    ingredients, stage,
    verdict: ["ok", "bad", "unsure"].includes(j.verdict) ? j.verdict : "unsure",
    reasons: { zh: String(r.zh || r.en || ""), en: String(r.en || r.zh || "") },
    confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "low",
    sources: Array.isArray(j.sources) ? j.sources.filter((u) => /^https?:\/\//.test(u)).slice(0, 3) : [],
  };
}
/* 拍商品外观：照片 → AI */
async function identifyFoodWithAI(dataUrl, pet, L, webSearch = false) {
  const b64 = dataUrl.split(",")[1];
  return normalizeFoodResult(extractJson(await foodCheckRequest(b64, buildFoodPrompt(pet, L, null, webSearch), FOOD_SYSTEM, { webSearch })));
}
/* 条码或手动输入：文字 → AI */
async function judgeFoodWithAI(product, pet, L, webSearch = false) {
  return normalizeFoodResult(extractJson(await foodCheckRequest(null, buildFoodPrompt(pet, L, product, webSearch), FOOD_SYSTEM, { webSearch })));
}

/* Netlify 版：交给 Supabase Edge Function「check-food」；b64 为 null 时只送文字；预设不上网，opts.webSearch 才开。
   见 supabase/functions/check-food/index.ts */
async function foodCheckRequest(b64, prompt, system, opts = {}) {
  const { data, error } = await supabase.functions.invoke("check-food", { body: {
    image: b64 || null, prompt, system, web_search: !!opts.webSearch, max_searches: opts.maxSearches || 2,
    max_tokens: opts.maxTokens || (opts.webSearch ? 900 : 600),
  } });
  if (error) {
    /* supabase.functions.invoke 把后端的错误内容藏在 context 里，尽量挖出来给画面看 */
    let detail = error.message || String(error);
    try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch { /* 忽略 */ }
    throw new Error(detail);
  }
  if (!data || typeof data.text !== "string") throw new Error(data?.error || "no-text");
  return data.text;
}

/* 检查商品：只看过敏原与年龄段 */
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

/* ---- 外部资料 ---- */

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

/* ---- 条码辨识（三层） ----
   ① BarcodeDetector：浏览器内建，Chrome / Android 有，iOS Safari 没有
   ② ZXing：纯 JavaScript 函式库，所有浏览器都能跑，是 iPhone 的主力
   ③ AI 读印刷数字：条码本身糊掉时，让 Claude 读条码下方那串数字，并做校验码检查
   回传 { code, via }，via 告诉画面是哪一层读到的（AI 读的要提醒使用者核对） */

/* GS1 校验码（EAN-13 / EAN-8 / UPC-A 通用）：从右数起权重 3,1,3,1…，总和补到 10 的倍数 */
function validBarcode(s) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(s)) return false;
  const d = s.split("").map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/* Netlify 版：ZXing 从 npm 套件载入（package.json 里的 @zxing/library） */
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
  /* 太大的照片反而难读；试两种尺寸 */
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

/* ---- 所有「把照片交给 AI」的功能都走这一个函式 ---- */
async function visionRequest(b64, prompt, maxTokens) {
  /* 和商品检查共用同一支 Supabase Edge Function（不上网），金钥只设在 Supabase 一处 */
  const { data, error } = await supabase.functions.invoke("check-food", { body: { image: b64, prompt, max_tokens: maxTokens, web_search: false } });
  if (error) {
    let detail = error.message || String(error);
    try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch { /* 忽略 */ }
    throw new Error(detail);
  }
  if (!data || typeof data.text !== "string") throw new Error(data?.error || "no-text");
  return extractJson(data.text);
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
  try { return { code: await decodeWithDetector(file), via: "detector" }; } catch { /* 下一层 */ }
  try { return { code: await decodeWithZXing(file), via: "zxing" }; } catch { /* 下一层 */ }
  if (onStage) onStage("ai");
  return { code: await readBarcodeDigitsWithAI(file), via: "ai" };
}

/* ---- 辨识宠物照片：物种与品种 ----
   重点是把答案「限定在我们自己的品种表里」：AI 只能回传 BREEDS 里的代码，
   回传其他东西一律当作没猜到。这样不会出现表里没有的品种，剪影也能对上。 */
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
  const [session, setSession] = useState(undefined); // undefined = 还在确认、null = 没登入
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [view, setView] = useState({ name: "list" });
  const [storageOk, setStorageOk] = useState(true);
  const L = STR[lang];

  /* 登入状态：开页时问一次，之后有变化（点了信里的连结、登出）会自动通知 */
  const [anonErr, setAnonErr] = useState(""); // 显示 Supabase 回的原始错误，方便排查
  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) { setSession(data.session); return; }
      if (AUTH_MODE !== "anonymous") { setSession(null); return; }
      /* 访客模式：没登入就自动开一个匿名帐号，同一个浏览器之后都会认得 */
      const { data: a, error } = await supabase.auth.signInAnonymously();
      if (error || !a.session) { setAnonErr((error && (error.message || String(error))) || "no session returned"); setSession(null); } else setSession(a.session);
    }).catch((e) => { setAnonErr(e?.message || String(e)); setSession(null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { if (s) setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* 登入后从云端载入自己的宠物 */
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

  /* 先更新画面，再写云端；写失败就亮出提醒 */
  async function savePet(pet) {
    const exists = pets.some((p) => p.id === pet.id);
    setPets(exists ? pets.map((p) => (p.id === pet.id ? pet : p)) : [...pets, pet]);
    setView({ name: "detail", id: pet.id });
    try {
      const saved = await upsertPet(pet, session.user.id);
      setPets((cur) => cur.map((p) => (p.id === saved.id ? saved : p)));
      setStorageOk(true);
    } catch { setStorageOk(false); }
  }
  async function removePet(id) {
    setPets(pets.filter((p) => p.id !== id));
    setView({ name: "list" });
    try { await deletePet(id, session.user.id); setStorageOk(true); } catch { setStorageOk(false); }
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
  else if (view.name === "mates" && current) body = <Playmates pet={current} allPets={pets} onBack={() => setView({ name: "detail", id: current.id })} />;
  else if (view.name === "check" && current) body = <CheckProduct pet={current} onBack={() => setView({ name: "detail", id: current.id })} />;
  else if (view.name === "detail" && current) body = <Detail pet={current} onBack={() => setView({ name: "list" })} onEdit={() => setView({ name: "form", id: current.id })} onCheck={() => setView({ name: "check", id: current.id })} onMates={() => setView({ name: "mates", id: current.id })} onDelete={() => removePet(current.id)} />;
  else body = <List pets={pets} storageOk={storageOk} onLogout={session.user.is_anonymous ? null : logout} onOpen={(id) => setView({ name: "detail", id })} onAdd={() => setView({ name: "form" })} />;

  return (
    <LangCtx.Provider value={{ lang, L, setLang }}>
      <div className="pp">
        <style>{CSS}</style>
        {body}
      </div>
    </LangCtx.Provider>
  );
}

/* ---------------- 登入页 ---------------- */

function Login() {
  const { L } = useL();
  const A = L.auth;
  const [email, setEmail] = useState("");
  const [state, setState] = useState(""); // "" | sending | sent | error

  async function send() {
    const e = email.trim();
    if (!e || state === "sending") return;
    setState("sending");
    /* 寄魔法连结；使用者点了连结会回到这个网址，Supabase 会自动完成登入 */
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

/* ---------------- 列表页 ---------------- */

function List({ pets, onOpen, onAdd, storageOk, onLogout }) {
  const { lang, L } = useL();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    loadStats(pets).then((st) => { if (alive) setStats(st); }).catch(() => {});
    return () => { alive = false; };
  }, [pets.length]);

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
            </button>
          ))
        )}
      </div>

      {stats && <div className="pp-stats">{L.stats(stats.owners, stats.pets)}</div>}

      {pets.length > 0 && <button className="pp-fab" onClick={onAdd} aria-label={L.addPet}>＋</button>}
    </>
  );
}

/* ---------------- 详细页 ---------------- */

function Detail({ pet, onBack, onEdit, onCheck, onMates, onDelete }) {
  const { lang, L } = useL();
  const [confirm, setConfirm] = useState(false);
  const advice = foodAdvice(pet, L, lang);
  const picks = recommendProducts(pet, L, lang);
  const care = careAdvice(pet, L, lang);

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
          <Row k={L.rows.ownerEmail} v={pet.ownerEmail || "—"} />
          {pet.note && <Row k={L.rows.note} v={pet.note} />}
        </dl>
      </div>

      <div style={{ padding: "0 16px 20px" }}>
        <button className="pp-btn-check" onClick={onCheck}>{L.checkBtn}</button>
        <button className="pp-btn-check" style={{ marginTop: 10 }} onClick={onMates}>{L.mates.btn}</button>
      </div>

      <div className="paper pp-annex">
        <span className="tape b" />
        <div className="pp-annex-h"><span className="pp-h">{L.annex1}</span><em>NOTE I</em></div>
        {advice.map((a, i) => <div className="pp-advice" key={i}><div className="k">{a.k}</div><div className="v">{a.v}</div></div>)}
      </div>

      <div className="paper pp-annex">
        <span className="tape c" />
        <div className="pp-annex-h"><span className="pp-h">{L.annex2}</span><em>NOTE II</em></div>
        {picks.length === 0 ? <div className="pp-none">{L.noProducts}</div> : picks.map((r) => (
          <div className="pp-prod" key={r.p.id}>
            <div className="pp-prod-top">
              <div style={{ minWidth: 0 }}>
                <div className="pp-prod-brand">{BRANDS[r.p.brand][li(lang)]} · {r.p.size}</div>
                <h3 className="pp-prod-name">{r.p.name[li(lang)]}</h3>
              </div>
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
        {care.map((m, i) => <div className="pp-advice" key={i}><div className="k">{m.k}</div><div className="v">{m.v}</div></div>)}
        <div className="pp-note">{L.care.sources}</div>
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

/* ---------------- 检查商品 ---------------- */

function CheckProduct({ pet, onBack }) {
  const { lang, L } = useL();
  const C = L.check;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [prod, setProd] = useState(null); // { name, ingredients, stage, source }
  const [picked, setPicked] = useState([]); // 手动输入时点选的成分 key
  const [ai, setAi] = useState(null); // 拍商品外观时 AI 的判断 { verdict, reasons, confidence, sources }
  const [aiErr, setAiErr] = useState(""); // 失败时的原始原因，方便排查
  const frontCamRef = useRef(null);
  const frontFileRef = useRef(null);
  const ingText = prod ? (prod.source === "manual" ? combineIngredients(picked, prod.ingredients) : prod.ingredients) : "";
  const result = prod && ingText.trim() ? checkProduct(pet, { ...prod, ingredients: ingText }) : null;
  const editProd = (patch) => { setProd({ ...prod, ...patch }); setAi(null); }; // 改了资料，旧的 AI 判断就不算数
  const lastFoodRef = useRef(null); // 记住上一次送给 AI 的东西，「上网查证」时重跑一次
  async function onVerify() {
    const last = lastFoodRef.current;
    if (!last || busy) return;
    setBusy("verify"); setMsg("");
    try {
      const r = last.kind === "photo" ? await identifyFoodWithAI(last.dataUrl, pet, L, true) : await judgeFoodWithAI(last.product, pet, L, true);
      if (last.kind === "photo") setProd({ name: r.name, ingredients: r.ingredients, stage: r.stage, source: "photo" });
      setAi({ verdict: r.verdict, reasons: r.reasons, confidence: r.confidence, sources: r.sources, searched: true });
      setAiErr("");
    } catch (e) { setMsg(C.judgeFail); setAiErr(e?.message || String(e)); }
    setBusy("");
  }
  async function onJudge() {
    if (!prod || busy) return;
    const product = { name: prod.name, ingredients: ingText, stage: prod.stage };
    if (!product.name.trim() && !product.ingredients.trim()) return;
    setBusy("judge"); setMsg(""); setAi(null);
    try {
      lastFoodRef.current = { kind: "text", product };
      const r = await judgeFoodWithAI(product, pet, L);
      const filled = { ...prod };
      if (!prod.name.trim() && r.name) filled.name = r.name;
      if (!ingText.trim() && r.ingredients) filled.ingredients = r.ingredients;
      if (prod.stage === "unknown" && r.stage !== "unknown") filled.stage = r.stage;
      setProd(filled);
      setAi({ verdict: r.verdict, reasons: r.reasons, confidence: r.confidence, sources: r.sources });
      setAiErr("");
    } catch (e) { setMsg(C.judgeFail); setAiErr(e?.message || String(e)); }
    setBusy("");
  }
  async function onFrontPhoto(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    setBusy("food"); setMsg(""); setAi(null);
    try {
      const dataUrl = await readImage(file, 1000);
      lastFoodRef.current = { kind: "photo", dataUrl };
      const r = await identifyFoodWithAI(dataUrl, pet, L);
      setProd({ name: r.name, ingredients: r.ingredients, stage: r.stage, source: "photo" });
      setAi({ verdict: r.verdict, reasons: r.reasons, confidence: r.confidence, sources: r.sources });
      setAiErr("");
    } catch (e) { setMsg(C.photoFail); setAiErr(e?.message || String(e)); }
    setBusy("");
  }
  const togglePick = (k) => { setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); setAi(null); };
  const barcodeRef = useRef(null);
  const [scanNote, setScanNote] = useState(""); // 条码是 AI 读的时候，提醒使用者核对

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
        <h2 className="pp-tier-h" style={{ margin: 0 }}>{C.title(pet.name)}</h2>
      </div>

      {!prod && (
        <>
          <div className="paper pp-tier">
            <span className="tape" />
            <h2 className="pp-tier-h">{C.tier0}</h2>
            <p className="pp-tier-d">{C.tier0d}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="pp-btn" onClick={() => frontCamRef.current?.click()} disabled={!!busy}>{busy === "food" ? <><span className="pp-spin" />{C.identifying}</> : C.takeFront}</button>
              <button className="pp-btn-ghost" onClick={() => frontFileRef.current?.click()} disabled={!!busy}>{C.pickFront}</button>
              <input ref={frontCamRef} type="file" accept="image/*" capture="environment" onChange={onFrontPhoto} style={{ display: "none" }} />
              <input ref={frontFileRef} type="file" accept="image/*" onChange={onFrontPhoto} style={{ display: "none" }} />
            </div>
            {busy === "food" && <div className="pp-wait"><span className="pp-spin" />{C.waitHint}</div>}
            {msg === C.photoFail && <div className="pp-msg">{msg}{aiErr && <div className="pp-src" style={{ marginTop: 4, wordBreak: "break-all" }}>{aiErr}</div>}</div>}
          </div>

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
            <span className="tape c" />
            <h2 className="pp-tier-h">{C.tier3}</h2>
            <p className="pp-tier-d">{C.tier3d}</p>
            <button className="pp-btn-ghost" onClick={() => setProd({ name: "", ingredients: "", stage: "unknown", source: "manual" })}>{C.manualStart}</button>
          </div>
        </>
      )}

      {prod && ai && (
        <div className="paper pp-annex pp-ai" style={{ paddingBottom: 6 }}>
          <span className="tape c" />
          <div className="pp-annex-h"><span className="pp-h">{C.aiTitle}</span><em>AI</em></div>
          <div className={`pp-verdict ${ai.verdict === "bad" ? "bad" : ai.verdict === "ok" ? "" : "mid"}`}>{C.aiVerdict[ai.verdict]}</div>
          <div className="pp-res">
            <div>{ai.reasons[lang] || ai.reasons.zh || ai.reasons.en}</div>
            <div className="pp-src" style={{ marginTop: 8 }}>{C.aiConf(C.conf[ai.confidence])}</div>
            {ai.sources.length > 0 && (
              <div className="pp-src" style={{ marginTop: 4 }}>
                {C.aiSources}：{ai.sources.map((u, i) => <span key={u}>{i > 0 ? " · " : ""}<a href={u} target="_blank" rel="noreferrer" style={{ color: "var(--ink)" }}>{new URL(u).hostname.replace(/^www\./, "")}</a></span>)}
              </div>
            )}
          </div>
          {!ai.searched && (ai.verdict === "unsure" || ai.confidence === "low") && (
            <div style={{ padding: "4px 16px 12px" }}>
              <button className="pp-btn-ghost" onClick={onVerify} disabled={!!busy}>{busy === "verify" ? <><span className="pp-spin" style={{ borderColor: "rgba(59,48,36,.2)", borderTopColor: "var(--ink)" }} />{C.verifying}</> : C.verifyBtn}</button>
              <div className="pp-hint">{C.verifyHint}</div>
              {msg === C.judgeFail && <div className="pp-msg">{msg}</div>}
            </div>
          )}
          <div className="pp-note">{C.aiNote}</div>
        </div>
      )}

      {prod && (
        <div className="paper pp-tier">
          <span className="tape" />
          <h2 className="pp-tier-h">{C.productTitle}</h2>
          <div className="pp-src" style={{ marginTop: 0, marginBottom: 12 }}>{C.sourceLabel}{C.sources[prod.source]}</div>
          <div className="pp-field">
            <label className="pp-label">{C.nameLabel}</label>
            <input className="pp-input" value={prod.name} onChange={(e) => editProd({ name: e.target.value })} />
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
                <textarea className="pp-textarea" value={prod.ingredients} onChange={(e) => editProd({ ingredients: e.target.value })} placeholder={C.ingPh} />
                {ingText && <div className="pp-hint">{C.pickedPreview(ingText)}</div>}
              </div>
            </>
          ) : (
            <div className="pp-field">
              <label className="pp-label">{C.ingLabel}</label>
              <textarea className="pp-textarea" style={{ minHeight: 96 }} value={prod.ingredients} onChange={(e) => editProd({ ingredients: e.target.value })} placeholder={C.ingPh} />
            </div>
          )}
          <div className="pp-field">
            <label className="pp-label">{C.stageLabel}</label>
            <select className="pp-select" value={prod.stage} onChange={(e) => editProd({ stage: e.target.value })}>
              {["young", "adult", "senior", "all", "unknown"].map((s) => <option key={s} value={s}>{C.stages[s]}</option>)}
            </select>
          </div>
          {!ai && (
            <div style={{ marginBottom: 10 }}>
              <button className="pp-btn" onClick={onJudge} disabled={!!busy || (!prod.name.trim() && !ingText.trim())}>
                {busy === "judge" ? <><span className="pp-spin" />{C.judging}</> : C.judgeBtn}
              </button>
              <div className="pp-hint">{C.judgeHint}</div>
              {msg === C.judgeFail && <div className="pp-msg">{msg}{aiErr && <div className="pp-src" style={{ marginTop: 4, wordBreak: "break-all" }}>{aiErr}</div>}</div>}
            </div>
          )}
          <button className="pp-btn-ghost" onClick={() => { setProd(null); setPicked([]); setAi(null); setMsg(""); setAiErr(""); }}>{C.clear}</button>
        </div>
      )}

      {result && !ai && (
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

/* ---------------- 寻找附近的玩伴 ---------------- */

function Playmates({ pet, allPets, onBack }) {
  const { lang, L } = useL();
  const M = L.mates;
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!pet.city) { setRows([]); return; }
    let alive = true;
    loadPlaymates(pet, allPets).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [pet.id, pet.city]);

  const city = cityLabel(pet.city, lang);

  return (
    <>
      <nav className="pp-nav">
        <button onClick={onBack}>{L.back}</button>
        <span>{M.nav}</span>
        <div className="pp-nav-right"><LangToggle /></div>
      </nav>

      <div className="paper pp-tier" style={{ marginTop: 18 }}>
        <span className="tape c" />
        <h2 className="pp-tier-h">{M.title(pet.name)}</h2>
        <p className="pp-tier-d" style={{ marginBottom: 0 }}>{pet.city ? M.intro(city, L.speciesName[pet.species]) : M.noCity}</p>
        {pet.species === "cat" && pet.city && <div className="pp-src">{M.catNote}</div>}
      </div>

      {pet.city && err && <div className="pp-notice">{M.fail}</div>}
      {pet.city && !err && rows === null && <div className="pp-notice">{M.loading}</div>}
      {pet.city && !err && rows && rows.length === 0 && <div className="pp-notice">{M.none(city)}</div>}

      {rows && rows.map((o) => {
        const reasons = o.isMatch ? playmateReasons(pet, o, L, rows.length === 1) : [];
        return (
          <div className={`pp-mate${o.isMatch ? " match" : ""}`} key={o.id}>
            {o.isMatch && <div className="pp-mate-badge">{M.best}</div>}
            <div className="pp-card-in">
              <Photo src={o.photo} species={o.species} breed={o.breed} />
              <div style={{ minWidth: 0 }}>
                <h2 className="pp-name">{o.name}</h2>
                <div className="pp-meta">
                  {breedLabel(o.species, o.breed, lang) || L.speciesName[o.species]} · {ageText(o.birthday, L)}
                  <br />
                  {o.weightKg ? L.kg(o.weightKg) : L.weightUnknown}{o.gender ? ` · ${L.gender[o.gender]}` : ""}{o.neutered ? ` · ${L.neuteredTag}` : ""}
                </div>
              </div>
            </div>
            {o.isMatch && (
              <>
                <div className="pp-mate-why">
                  <div className="pp-why-h">{M.why}</div>
                  <ul className="pp-why">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
                <div className="pp-mate-contact">
                  <div className="k">{M.contact}</div>
                  {o.ownerEmail ? <a href={`mailto:${o.ownerEmail}`} style={{ color: "var(--ink)" }}>{o.ownerEmail}</a> : <span style={{ color: "var(--ink-soft)" }}>{M.noEmail}</span>}
                </div>
              </>
            )}
          </div>
        );
      })}
      <div style={{ height: 40 }} />
    </>
  );
}

/* ---------------- 表单 ---------------- */

const EMPTY = { name: "", species: "dog", breed: "", gender: "", birthday: "", weightKg: "", neutered: false, allergies: [], city: "", ownerEmail: "", note: "", photo: "" };

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
  const lastFileRef = useRef(null); // 原始照片档，辨识时用较高解析度
  const [guessBusy, setGuessBusy] = useState(false);
  const [guessMsg, setGuessMsg] = useState("");
  async function pickPhoto(e) {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    try { set("photo", await readImage(file, 800)); lastFileRef.current = file; setGuessMsg(""); } catch { setErr(F.errPhoto); return; }
    /* 选好照片就自动辨识；已经选了品种的（例如编辑旧资料）不覆盖，想重辨识按按钮 */
    if (!f.breed) guessFromPhoto(file);
  }
  function removePhoto() { set("photo", ""); lastFileRef.current = null; setGuessMsg(""); }
  async function guessFromPhoto(fileArg) {
    const file = fileArg instanceof File ? fileArg : lastFileRef.current;
    if ((!file && !f.photo) || guessBusy) return;
    setGuessBusy(true); setGuessMsg("");
    try {
      let dataUrl;
      if (file) dataUrl = await readImage(file, 900);
      else if (f.photo.startsWith("data:")) dataUrl = f.photo;
      else dataUrl = await readImage(await (await fetch(f.photo)).blob(), 900); // 照片是网址（存在 Storage）时先抓回来
      const g = await guessPetWithAI(dataUrl);
      if (!g.species) { setGuessMsg(F.guessNone); }
      else {
        setBreedOther(false);
        setF((s) => ({ ...s, species: g.species, breed: g.breed || "" }));
        setGuessMsg(F.guessDone(L.speciesName[g.species], g.breed ? breedLabel(g.species, g.breed, lang) : ""));
      }
    } catch { setGuessMsg(F.guessFail); }
    setGuessBusy(false);
  }
  function submit() {
    if (!f.name.trim()) return setErr(F.errName);
    if (!f.birthday) return setErr(F.errBirthday);
    if (f.birthday > today) return setErr(F.errFuture);
    const email = (f.ownerEmail || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr(F.errEmail);
    setErr("");
    onSave({ ...f, id: pet?.id || uid(), name: f.name.trim(), breed: f.breed.trim(), weightKg: f.weightKg === "" ? "" : Number(f.weightKg), ownerEmail: email,
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
          <div className="pp-req-note">{F.reqNote}</div>
          <div className="pp-field">
            <label className="pp-label">{F.photo}</label>
            <div className="pp-photo-pick">
              <Photo src={f.photo} species={f.species} breed={f.breed} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="pp-btn" onClick={() => camRef.current?.click()}>{F.takePhoto}</button>
                <button className="pp-btn-ghost" onClick={() => fileRef.current?.click()}>{F.fromGallery}</button>
                {f.photo && <button className="pp-btn-danger" onClick={removePhoto}>{F.removePhoto}</button>}
                <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} style={{ display: "none" }} />
                <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} style={{ display: "none" }} />
              </div>
            </div>
            <div className="pp-hint">{F.photoHint}</div>
            {f.photo && (
              <div style={{ marginTop: 12 }}>
                <button className="pp-btn-ghost" onClick={() => guessFromPhoto()} disabled={guessBusy}>{guessBusy ? <><span className="pp-spin" style={{ borderColor: "rgba(59,48,36,.2)", borderTopColor: "var(--ink)" }} />{F.guessing}</> : guessMsg ? F.guessAgain : F.guess}</button>
                {guessMsg && <div className="pp-msg soft" style={{ color: "#3B3024" }}>{guessMsg}</div>}
              </div>
            )}
          </div>

          <div className="pp-field">
            <label className="pp-label req" htmlFor="nm">{F.name}<i>*</i></label>
            <input id="nm" className="pp-input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={F.namePh} />
          </div>

          <div className="pp-field">
            <label className="pp-label req">{F.species}<i>*</i></label>
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
            <label className="pp-label req" htmlFor="bd">{F.birthday}<i>*</i></label>
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
              {Object.keys(CITIES).map((k) => <option key={k} value={k}>{cityLabel(k, lang)}</option>)}
            </select>
            <div className="pp-hint">{F.cityHint}</div>
          </div>

          <div className="pp-field">
            <label className="pp-label" htmlFor="oe">{F.ownerEmail}</label>
            <input id="oe" className="pp-input" type="email" inputMode="email" autoComplete="email" value={f.ownerEmail || ""} onChange={(e) => set("ownerEmail", e.target.value)} placeholder="you@example.com" />
            <div className="pp-hint">{F.ownerEmailHint}</div>
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


/* ---- 体重拉杆：拉大概位置，用 −／＋ 微调 0.1 ---- */
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
        <div className={cls} style={{ color: "#A08F76" }}>
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
