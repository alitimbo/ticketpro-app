import { describe, expect, it } from "vitest";
import { MikroTikRouterAdapter } from "./MikroTikRouterAdapter";
import type {
  RouterOsApiBatchCommand,
  RouterOsApiBatchResponse,
  RouterOsApiConfig,
  RouterOsApiRequest,
  RouterOsApiRow,
  RouterOsApiTransport
} from "./RouterOsApiTransport";

type RouterOsApiBatchRequest = RouterOsApiConfig & { commands: RouterOsApiBatchCommand[]; pipelineWindow?: number };

class BatchTransport implements RouterOsApiTransport {
  readonly batches: RouterOsApiBatchRequest[] = [];
  readonly calls: RouterOsApiRequest[] = [];
  constructor(private readonly users: RouterOsApiRow[], private readonly failAt: number | null = null) {}
  async call(request: RouterOsApiRequest): Promise<RouterOsApiRow[]> {
    this.calls.push(request);
    return this.users;
  }
  async callBatch(request: RouterOsApiBatchRequest): Promise<RouterOsApiBatchResponse> {
    this.batches.push(request);
    const results = request.commands.map((command, index) => index === this.failAt
      ? { error: "timeout", rows: [] }
      : { error: null, rows: this.users.filter((row) => Object.entries(command.queries ?? {}).every(([key, value]) => row[key] === value)) });
    return { completedCount: results.length, connectionError: null, results };
  }
}

const adapter = (transport: RouterOsApiTransport) => new MikroTikRouterAdapter({
  host: "192.168.88.1", password: "secret-not-logged", port: 8728, timeoutMs: 1000, transport, username: "api-user"
});
const row = (name: string): RouterOsApiRow => ({
  ".id": `*${name}`, "bytes-in": "10", "bytes-out": "20", comment: "TicketPro:v1;validity=60;expires=0;state=new;",
  "limit-bytes-total": "2147483648", "mac-address": "AA:BB:CC:DD:EE:01", name, profile: "6H-2G"
});

describe("MikroTikRouterAdapter.listHotspotUsersByUsernames", () => {
  it("lit les seuls vouchers demandés, en une connexion, sans mot de passe", async () => {
    const transport = new BatchTransport([row("A"), row("B"), row("C")]);
    const users = await adapter(transport).listHotspotUsersByUsernames(["A", "C", "A", "absent"]);

    expect(users.map((user) => user.username)).toEqual(["A", "C"]);
    expect(users[0]).toMatchObject({ limitBytesTotal: 2147483648, macAddress: "AA:BB:CC:DD:EE:01" });
    expect(transport.calls).toEqual([]);
    expect(transport.batches).toHaveLength(1);
    expect(transport.batches[0].commands).toHaveLength(3);
    for (const command of transport.batches[0].commands) {
      expect(command.command).toBe("/ip/hotspot/user/print");
      expect(String(command.params?.[".proplist"])).not.toContain("password");
    }
  });

  it("refuse une lecture partielle plutôt que de faire disparaître un voucher", async () => {
    const transport = new BatchTransport([row("A"), row("B")], 1);
    await expect(adapter(transport).listHotspotUsersByUsernames(["A", "B"])).rejects.toThrow();
  });

  it("au-delà de 250 vouchers, une seule lecture allégée remplace les lectures ciblées", async () => {
    const names = Array.from({ length: 251 }, (_, index) => `V${index}`);
    const transport = new BatchTransport(names.map(row));
    const users = await adapter(transport).listHotspotUsersByUsernames(names);

    expect(users).toHaveLength(251);
    expect(transport.batches).toEqual([]);
    expect(transport.calls).toHaveLength(1);
    expect(String(transport.calls[0].params?.[".proplist"])).not.toContain("password");
  });

  it("ne contacte pas le routeur sans session active", async () => {
    const transport = new BatchTransport([row("A")]);
    expect(await adapter(transport).listHotspotUsersByUsernames([])).toEqual([]);
    expect(transport.batches).toEqual([]);
  });
});

describe("MikroTikRouterAdapter.listVoucherBatchUsers", () => {
  const batchComment = "TicketPro:v1;validity=60;expires=0;state=new;batch=lot-1;";
  const batchRow = (name: string): RouterOsApiRow => ({ ...row(name), comment: batchComment });

  it("relit le lot en une seule rafale : chaque voucher par son nom et tout voucher portant le commentaire du lot", async () => {
    // "STRAY" carries the batch comment without being requested: the batch
    // check must still see it. "AUTRE" belongs to another batch.
    const transport = new BatchTransport([batchRow("A"), batchRow("B"), batchRow("STRAY"), row("AUTRE")]);
    const users = await adapter(transport).listVoucherBatchUsers({ lifecycleComment: batchComment, usernames: ["A", "B"] });

    expect(users.map((user) => user.username).sort()).toEqual(["A", "B", "STRAY"]);
    expect(transport.calls).toEqual([]);
    expect(transport.batches).toHaveLength(1);
    expect(transport.batches[0].commands).toHaveLength(3);
    expect(transport.batches[0].commands[2].queries).toEqual({ comment: batchComment });
    // Independent reads: sent ahead of their replies.
    expect(transport.batches[0].pipelineWindow).toBeGreaterThan(1);
  });
});

