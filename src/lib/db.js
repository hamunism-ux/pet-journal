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

/* RLS 會自動只回傳「登入者自己的」寵物，前端不用再過濾 */
export async function loadPets() {
  const { data, error } = await supabase.from("pets").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(fromRow);
}
export async function upsertPet(pet, ownerId) {
  const { error } = await supabase.from("pets").upsert(toRow(pet, ownerId));
  if (error) throw error;
}
export async function deletePet(id) {
  const { error } = await supabase.from("pets").delete().eq("id", id);
  if (error) throw error;
}
