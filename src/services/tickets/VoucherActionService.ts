import type { RouterService } from "../router";

export class VoucherActionService {
  constructor(
    private readonly routerService: Pick<
      RouterService,
      "disableHotspotUser" | "disconnectActiveUser" | "enableHotspotUser" | "listActiveUsers" | "removeHotspotUser"
    >
  ) {}

  async disable(username: string): Promise<{ disconnected: boolean }> {
    await this.routerService.disableHotspotUser(username);
    const activeUsers = await this.routerService.listActiveUsers();
    const isActive = activeUsers.some((user) => user.username === username);

    if (isActive) {
      await this.routerService.disconnectActiveUser(username);
    }

    return { disconnected: isActive };
  }

  async enable(username: string): Promise<void> {
    await this.routerService.enableHotspotUser(username);
  }

  async remove(username: string): Promise<void> {
    await this.routerService.removeHotspotUser(username);
  }
}
