import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

type PortsResult = { ports: string[] };
type HelperReply =
  | { id: number; ok: true; result?: PortsResult }
  | { id: number; ok: false; error: string };
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

class MidiHelper {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  private start(): void {
    if (this.process && !this.process.killed) return;
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const helperPath = path.join(pluginRoot, "midi-helper.ps1");
    this.process = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    readline.createInterface({ input: this.process.stdout }).on("line", (line) => {
      try {
        const reply = JSON.parse(line) as HelperReply;
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(reply.id);
        if (reply.ok) pending.resolve(reply.result);
        else pending.reject(new Error(reply.error));
      } catch {
        // Ignore non-protocol PowerShell output.
      }
    });

    const stopped = (reason: string): void => {
      this.process = undefined;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
        this.pending.delete(id);
      }
    };
    this.process.on("error", (error) => stopped(`MIDI helper failed: ${error.message}`));
    this.process.on("exit", (code) => stopped(`MIDI helper stopped unexpectedly (${code ?? "unknown"}).`));
    this.process.stdin.on("error", (error) => stopped(`MIDI helper input failed: ${error.message}`));
  }

  private request<T>(command: object, timeoutMs = 3000): Promise<T> {
    this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MIDI operation timed out."));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.process?.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  async getPorts(): Promise<string[]> {
    const result = await this.request<PortsResult>({ cmd: "ports" });
    return result.ports;
  }

  async send(port: string, bytes: number[]): Promise<void> {
    await this.request({ cmd: "send", port, bytes }, 5000);
  }
}

export const midiHelper = new MidiHelper();
