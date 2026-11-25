import { PrismaClient, Role, Tier } from '@prisma/client';
import { hashPassword } from '../src/services/user.service.js';

const prisma = new PrismaClient();

const SEED_USERS: Array<{ email: string; tier: Tier; displayName: string }> = [
  { email: 'free@example.test', tier: Tier.FREE, displayName: 'Free Tester' },
  { email: 'pro@example.test', tier: Tier.PRO, displayName: 'Pro Tester' },
];

async function main(): Promise<void> {
  const passwordHash = await hashPassword('Password123!');
  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { tier: u.tier, displayName: u.displayName },
      create: { ...u, passwordHash, emailVerified: true },
    });
  }
  // Dev only: promote ADMIN_EMAIL so a fresh database has someone who can open the console.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail && process.env.NODE_ENV !== 'production') {
    const res = await prisma.user.updateMany({ where: { email: adminEmail }, data: { role: Role.ADMIN } });
    console.log(
      res.count ? `Promoted ${adminEmail} to ADMIN` : `ADMIN_EMAIL ${adminEmail} has no account yet; sign up, then re-seed`,
    );
  }
  console.log(`Seeded ${SEED_USERS.length} users`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
