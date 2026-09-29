import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();

async function main() {
  await db.user.upsert({
    where: { email: "admin@shop.lk" },
    update: {},
    create: { name: "Admin", email: "admin@shop.lk", password: await bcrypt.hash("admin123", 10), role: "ADMIN" },
  });

  const cats = ["Earrings", "Bangles", "Chains", "Long Chains", "Necklaces", "Rings", "Bracelets", "Anklets", "Bridal Jewellery", "Hair Accessories", "Fancy Jewellery"];
  for (const [i, name] of cats.entries()) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    await db.category.upsert({ where: { slug }, update: {}, create: { name, slug, sort: i } });
  }

  await db.shopSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  console.log(`Seeded: admin@shop.lk / admin123, ${cats.length} categories, shop settings`);
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
