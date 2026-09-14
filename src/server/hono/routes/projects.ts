import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { createProjectSchema } from "@/lib/utils/zod-schemas";
import type { AppEnv } from "../app";

const route = new Hono<AppEnv>();

// List only the caller's own projects - never a global list (section 8).
route.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.select().from(projects).where(eq(projects.ownerId, userId));
  return c.json(rows);
});

route.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createProjectSchema.parse(await c.req.json());
  const [row] = await db
    .insert(projects)
    .values({ ownerId: userId, title: body.title })
    .returning();
  return c.json(row, 201);
});

// Ownership check helper, reused by episodes/sessions routes.
export async function assertProjectOwnership(userId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
  if (!row) throw new Error("not found or not owned by caller");
  return row;
}

export default route;
