import { Hono } from "hono";
import { cors } from "hono/cors";

interface MrbcModule extends EmscriptenModule {
	FS: typeof FS,
	callMain: (args: string[]) => number
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(
  "/*", cors({ origin: "*" })
);

app.get("/", (c) => c.text("kanicc is up!"));

app.get("/versions", (c) => c.json([{version: "3.4.0"}]));

app.post("/code", async (c) => {
  const body = await c.req.json<{ code: string }>();
  const code = body.code;
  
  const decoded = Uint8Array.fromBase64(code);
  const id = crypto.randomUUID();
  const filename = `${id}.rb`;

  try {
    await c.env.R2.put(filename, decoded);
  } catch {
    return c.json({
      status: "failed to write file",
      id: "",
    }, 500);
  }

  return c.json({
    status: "ok",
    id: id
  });
})

app.post("/code/:id/compile", async (c) => {
  const id = c.req.param().id;
  const filename = `${id}.rb`
  
  try {
    const file = await c.env.R2.get(filename);
    if (file == null) {
      return c.json({
        status: "invalid id",
        id: "",
      })
    }

    const code = await file.text();
    const { default: mrbcModule } = await import("./assets/mrbc") as { default: EmscriptenModuleFactory<MrbcModule> };
    const { default: mrbcWasm } = await import("./assets/mrbc.wasm");

    const errors: string[] = [];
    const mrbc = await mrbcModule({
      noInitialRun: true,
      print: console.log,
      printErr: (str) => errors.push(str),
      instantiateWasm: (imports, callback) => {
        const instance = new WebAssembly.Instance(mrbcWasm, imports);
        callback(instance);
        return instance.exports;
      }
    })

    mrbc.FS.writeFile("/input.rb", code);
    mrbc.callMain(["-v"]);
    const res = mrbc.callMain(["-o", "/output.mrb", "/input.rb"]);
    if (res != 0) {
      return c.json({
        status: "error",
        error: errors.join("\n")
      })
    }

    const binary = mrbc.FS.readFile("/output.mrb");
    const encoded = binary.toBase64();
    return c.json({
      status: "ok",
      binary: encoded
    })
  } catch (err) {
    return c.json({
      status: "failed to compile",
      id: "",
    }, 500);
  }
})

app.get("/code/:id", async (c) => {
  const id = c.req.param().id;
  const filename = `${id}.rb`;

  const file = await c.env.R2.get(filename);
  if (file == null) {
    return c.json({
      error: "internal error"
    }, 400)
  }

  const code = new Uint8Array(await file.arrayBuffer());
  const encoded = code.toBase64();

  return c.json({
    code: encoded
  });
})

export default app;
