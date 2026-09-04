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
    owner_email: p.ownerEmail || null,
    note: p.note || null,
    photo: p.photo || null,
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
    ownerEmail: r.owner_email || "",
    note: r.note || "",
    photo: r.photo || "",
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
export async function deletePet(id, ownerId) {
  const { error } = await supabase.from("pets").delete().eq("id", id);
  if (error) throw error;
  if (ownerId) await deletePhoto(ownerId, id);
}
