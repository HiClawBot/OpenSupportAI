import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export function createPrismaClient(
  databaseUrl: string | undefined = process.env["DATABASE_URL"]
): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Prisma storage");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });
}
