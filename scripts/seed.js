import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { catalog } from "../shared/catalog.js";
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong .env.");
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
for (const [index, p] of catalog.entries()) {
  const { variants, ...fields } = p;
  const { data: existing, error: lookup } = await db
    .from("products")
    .select("id")
    .eq("slug", p.slug)
    .maybeSingle();
  if (lookup) throw lookup;
  // Re-running seed never overwrites prices/stock managed by administrators.
  if (existing) {
    console.log(`Skip ${p.slug}: already exists`);
    continue;
  }
  const { data, error } = await db
    .from("products")
    .insert({ ...fields, sort_order: index })
    .select()
    .single();
  if (error) throw error;
  const { error: err } = await db.from("variants").insert(
    variants.map((v) => ({
      ...v,
      product_id: data.id,
      stock: v.delivery === "key" ? 0 : v.stock,
    })),
  );
  if (err) throw err;
  console.log(`Created ${p.slug}`);
}
console.log(
  "Seed complete. Key products start with zero stock; import valid keys in Admin. No demo keys are inserted into Supabase.",
);
