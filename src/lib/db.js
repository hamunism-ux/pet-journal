/* 資料存取層：App.jsx 只跟這個檔案講話，不直接碰 Supabase。
   以後要換資料庫、加欄位，改這裡就好。 */
import { supabase } from "./supabase";

/* 語言偏好不需要跟著帳號，存在瀏覽器就好 */
const LANG_KEY = "pet-journal-lang";
export function loadLang() {
  try { const v = localStorage.getItem(LANG_KEY); return v === "zh" || v === "en" ? v : "en"; } catch { return "en"; }
}
export function saveLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch { /* 忽略 */ } }

/* 程式裡用的物件（camelCase）<-> 資料表的欄位（snake_case） */
function toRow(p, ownerId) {
  return {
    id: p.id,
    owner_id: ownerId,
    name: p.name,
    species: p.species,
    breed: p.breed || null,
    gender: p.gender || null,
    birthday: p.birthday || null,
    weight_kg: p.weightKg === "" || p.weightKg == null ? null : Number(p.weightKg),
    neutered: !!p.neutered,
    allergies: p.allergies || [],
    city: p.city || null,
    note: p.note || null,
    photo: p.photo || null,
    advice: p.advice || null,
    advice_key: p.adviceKey || null,
    updated_at: new Date().toISOString(),
  };
}
function fromRow(r) {
  return {
    id: r.id,
    name: r.name,
    species: r.species,
    breed: r.breed || "",
    gender: r.gender || "",
    birthday: r.birthday || "",
    weightKg: r.weight_kg == null ? "" : Number(r.weight_kg),
    neutered: !!r.neutered,
    allergies: r.allergies || [],
    city: r.city || "",
    note: r.note || "",
    photo: r.photo || "",
    advice: r.advice || null,
    adviceKey: r.advice_key || "",
    createdAt: r.created_at,
  };
}

/* ---- 照片：存 Storage，資料表只存網址 ---- */
const BUCKET = "pet-photos";
const photoPath = (ownerId, petId) => `${ownerId}/${petId}.jpg`;

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* 把 app 裡的照片（data: 開頭的字串）傳到 Storage，回傳公開網址 */
export async function uploadPhoto(dataUrl, ownerId, petId) {
  const path = photoPath(ownerId, petId);
  const { error } = await supabase.storage.from(BUCKET).upload(path, dataUrlToBlob(dataUrl), { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`; // 加時間戳，覆蓋同名檔案時才不會拿到舊的快取
}
export async function deletePhoto(ownerId, petId) {
  try { await supabase.storage.from(BUCKET).remove([photoPath(ownerId, petId)]); } catch { /* 沒檔案也沒關係 */ }
}

/* RLS 會自動只回傳「登入者自己的」寵物，前端不用再過濾 */
export async function loadPets() {
  const { data, error } = await supabase.from("pets").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(fromRow);
}
/* 儲存寵物。照片如果還是 data: 字串就先上傳、換成網址；照片被清空就把檔案刪掉。
   回傳存進資料庫的那一版（照片已是網址），呼叫端要用它更新畫面。 */
export async function upsertPet(pet, ownerId) {
  let next = pet;
  if (pet.photo && pet.photo.startsWith("data:")) {
    next = { ...pet, photo: await uploadPhoto(pet.photo, ownerId, pet.id) };
  } else if (!pet.photo) {
    await deletePhoto(ownerId, pet.id);
  }
  const { error } = await supabase.from("pets").upsert(toRow(next, ownerId));
  if (error) throw error;
  return next;
}
/* 只更新 AI 建议快取，不动其他栏位 */
export async function saveAdvice(id, advice, adviceKey) {
  const { error } = await supabase.from("pets").update({ advice, advice_key: adviceKey }).eq("id", id);
  if (error) throw error;
}
/* ---- v4.5 商品检查结果快取（food_checks 表，见 supabase/migrate-v10-food-checks.sql） ----
   同一张照片（或同一段输入文字）＋ 同一只宠物的资料指纹 → 直接用上次结果，不再呼叫 AI。
   owner_id 由资料库自动填成登入者，前端不用传；RLS 保证只看得到自己的。 */
export async function loadFoodCheck(petId, inputHash, petKey) {
  const { data, error } = await supabase.from("food_checks").select("result")
    .eq("pet_id", petId).eq("input_hash", inputHash).eq("pet_key", petKey).maybeSingle();
  if (error) throw error;
  return data?.result || null;
}
export async function saveFoodCheck(petId, inputHash, petKey, result) {
  const { error } = await supabase.from("food_checks")
    .upsert({ pet_id: petId, input_hash: inputHash, pet_key: petKey, result, created_at: new Date().toISOString() }, { onConflict: "pet_id,input_hash,pet_key" });
  if (error) throw error;
}
/* ---- v4.8.0 纯文字聊天（conversations / messages 表与函式，见 supabase/migrate-v11-chat.sql） ----
   开对话、收件匣、标已读都是资料库函式（只有当事人拿得到自己的）；讯息本身直接读写 messages 表，RLS 管权限。 */
export async function startConversation(myPetId, theirPetId, reasons = null) {
  const { data, error } = await supabase.rpc("start_conversation", { p_my_pet: myPetId, p_their_pet: theirPetId, p_reasons: reasons }); // v4.8.6：一并存下当时的配对理由
  if (error) throw error;
  return data; // conversation id
}
export async function loadInbox() {
  const { data, error } = await supabase.rpc("inbox");
  if (error) throw error;
  return data || [];
}
export async function loadMessages(convId, afterId = 0) {
  const { data, error } = await supabase.from("messages").select("id, sender_id, body, created_at")
    .eq("conversation_id", convId).gt("id", afterId).order("id", { ascending: true }).limit(300);
  if (error) throw error;
  return data || [];
}
export async function sendMessage(convId, body) {
  const { data, error } = await supabase.from("messages").insert({ conversation_id: convId, body })
    .select("id, sender_id, body, created_at").single();
  if (error) throw error;
  return data;
}
export async function markRead(convId) {
  const { error } = await supabase.rpc("mark_read", { p_conv: convId });
  if (error) throw error;
}
export async function deletePet(id, ownerId) {
  const { error } = await supabase.from("pets").delete().eq("id", id);
  if (error) throw error;
  if (ownerId) await deletePhoto(ownerId, id);
}
