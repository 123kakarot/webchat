/** Chuẩn hóa tên để bắt lách luật (dấu, khoảng trắng, dấu câu). */
export function normalizeNameForFilter(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

/** Cụm tục (đã bỏ dấu) — chỉ dùng từ đủ dài, tránh chặn nhầm tên. */
const BLOCKED_FRAGMENTS = [
  "ditme",
  "ditmemay",
  "dcm",
  "dcmm",
  "dmm",
  "clgt",
  "clmm",
  "vcl",
  "vkl",
  "cailon",
  "cailoz",
  "thangcho",
  "concho",
  "occho",
  "sucvat",
  "daubuoi",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "wtf",
  "stfu",
];

const BLOCKED_EXACT = new Set(["admin", "mod", "system", "root"]);

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateDisplayName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Vui lòng nhập tên." };
  }
  if (trimmed.length > 32) {
    return { ok: false, reason: "Tên tối đa 32 ký tự." };
  }

  const norm = normalizeNameForFilter(trimmed);
  if (norm.length < 2) {
    return { ok: false, reason: "Tên quá ngắn." };
  }

  if (BLOCKED_EXACT.has(norm)) {
    return { ok: false, reason: "Tên này không được dùng." };
  }

  if (norm.includes("duy")) {
    return { ok: false, reason: "Tên không hợp lệ." };
  }

  for (const frag of BLOCKED_FRAGMENTS) {
    if (norm.includes(frag)) {
      return { ok: false, reason: "Tên chứa từ ngữ không phù hợp." };
    }
  }

  return { ok: true };
}
