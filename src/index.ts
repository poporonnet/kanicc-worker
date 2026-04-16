import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("/*", cors({ origin: "*" }));

app.get("/", (c) => c.text("kanicc is up!"));

app.get("/versions", (c) => c.json([{ version: "3.4.0" }]));

app.post("/code", async (c) => {
  const body = await c.req.json<{ code: string }>();
  const code = body.code;

  const source = new TextDecoder().decode(Uint8Array.fromBase64(code));
  if (!source) {
    return c.json({ error: "invalid code" }, 400);
  }

  const id = crypto.randomUUID();
  const server = c.env.COMPILE_SERVER.getByName(id);

  try {
    await server.handleUpload(source);
  } catch {
    return c.json(
      {
        status: "failed to write file",
        id: "",
      },
      500,
    );
  }

  return c.json({
    status: "ok",
    id,
  });
});

app.post("/code/:id/compile", async (c) => {
  const id = c.req.param().id;
  const server = c.env.COMPILE_SERVER.getByName(id);

  try {
    return await server.handleCompile();
  } catch {
    return c.json(
      {
        status: "failed to compile",
        id: "",
      },
      500,
    );
  }
});

app.get("/code/:id", async (c) => {
  const id = c.req.param().id;
  const server = c.env.COMPILE_SERVER.getByName(id);
  const source = await server.getSource();

  if (source == null) {
    return c.json(
      {
        error: "internal error",
      },
      400,
    );
  }

  const code = new TextEncoder().encode(source).toBase64();
  return c.json({
    code,
  });
});

export default app;
export { CompileServer } from "./compileServer";
