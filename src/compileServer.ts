import { DurableObject } from "cloudflare:workers";

interface MrbcModule extends EmscriptenModule {
  FS: typeof FS;
  callMain: (args: string[]) => number;
}

export class CompileServer extends DurableObject {
  private source?: string;
  private binaryBase64?: string;
  private stdout: string[];
  private stderr: string[];
  private compiled?: Promise<Response>;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.source = undefined;
    this.binaryBase64 = undefined;
    this.stdout = [];
    this.stderr = [];
    this.compiled = undefined;
  }

  async getSource(): Promise<string | undefined> {
    return this.source ?? (await this.ctx.storage.get("source"));
  }

  async handleUpload(source: string): Promise<void> {
    this.source = source;
    this.compiled = this.compile(source);
    this.ctx.waitUntil(this.ctx.storage.put("source", source));
    this.ctx.waitUntil(this.compiled);
  }

  async handleCompile(): Promise<Response> {
    if (this.binaryBase64 != null) {
      return Response.json({
        status: "ok",
        binary: this.binaryBase64,
      });
    }

    if (this.compiled == null) {
      const source = await this.getSource();
      if (source == null) {
        return Response.json(
          {
            status: "invalid id",
            id: "",
          },
          { status: 400 },
        );
      }

      this.compiled = this.compile(source);
    }
    return await this.compiled;
  }

  private async compile(source: string): Promise<Response> {
    const { default: mrbcModule } = (await import("./assets/mrbc")) as {
      default: EmscriptenModuleFactory<MrbcModule>;
    };
    const { default: mrbcWasm } = await import("./assets/mrbc.wasm");

    this.stdout = [];
    this.stderr = [];
    const print = (out: string) => this.stdout.push(out);
    const printErr = (err: string) => this.stderr.push(err);
    const mrbc = await mrbcModule({
      noInitialRun: true,
      print,
      printErr,
      instantiateWasm: (imports, callback) => {
        const instance = new WebAssembly.Instance(mrbcWasm, imports);
        callback(instance);
        return instance.exports;
      },
    });

    mrbc.FS.writeFile("/input.rb", source);
    const res = mrbc.callMain(["-o", "/output.mrb", "/input.rb"]);
    if (res !== 0) {
      return Response.json({
        status: "error",
        error: this.stderr.join("\n"),
      });
    }

    const out = mrbc.FS.readFile("/output.mrb");
    const binary = out.toBase64();
    this.binaryBase64 = binary;
    return Response.json({
      status: "ok",
      binary,
    });
  }
}
