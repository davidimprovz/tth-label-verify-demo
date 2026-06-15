// Lenient coercion helpers for turning freeform values into typed fields.

/** Coerce a freeform string to bool (yes/true/1/y/imported → true). */
export function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  const s = String(v ?? "").trim().toLowerCase()
  return ["true", "1", "yes", "y", "import", "imported", "on"].includes(s)
}
