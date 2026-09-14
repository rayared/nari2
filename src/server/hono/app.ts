import { Hono } from "hono";
import { auth } from "@/server/auth";
import projects from "./routes/projects";
import episodes from "./routes/episodes";
import sessions from "./routes/sessions";
import sounds from "./routes/sounds";

export type AppEnv = {
  Variables: { userId: string };
};

const app = new Hono<AppEnv>().basePath("/api");

// Every route below requires an authenticated Auth.js session. This is the
// single choke point mentioned in section 8 ("هر کوئری با owner_id اسکوپ
// شود") - userId is read from here and threaded into every query.
app.use("*", async (c, next) => {
  const session = await auth();
  if (!session?.user?.id) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  await next();
});

app.route("/projects", projects);
app.route("/episodes", episodes);
app.route("/sessions", sessions);
app.route("/sounds", sounds);

export default app;
