import type { TicketRecord } from "../../domain/database";
import type { ActiveHotspotUser, HotspotUser } from "../../domain/router";
import type { RouterService } from "../router";
import type { TicketRepository } from "../database/repositories";
import { isMacAddress, normalizeMacAddress } from "./RouterAccessPolicyService";

export type VoucherBindingConflict = {
  expectedMacAddress: string;
  observedMacAddress: string;
  username: string;
};

export type VoucherBindingResult = {
  boundUsernames: string[];
  /** RouterOS users re-read after a successful MAC write. */
  verifiedUsers: HotspotUser[];
  conflicts: VoucherBindingConflict[];
  errors: Array<{ message: string; username: string }>;
};

const TICKETPRO_VOUCHER_MARKER = "TicketPro:v1;";

export class VoucherDeviceBindingService {
  constructor(private readonly tickets: TicketRepository) {}

  async synchronize(input: {
    accountId: string;
    activeUsers: ActiveHotspotUser[];
    hotspotUsers: HotspotUser[];
    routerId: string;
    routerService: RouterService;
    tickets: TicketRecord[];
  }): Promise<VoucherBindingResult> {
    const result: VoucherBindingResult = {
      boundUsernames: [],
      verifiedUsers: [],
      conflicts: [],
      errors: []
    };
    const ticketsByUsername = new Map(
      input.tickets.map((ticket) => [ticket.username, ticket])
    );
    const usersByUsername = new Map(
      input.hotspotUsers.map((user) => [user.username, user])
    );
    const boundMacsByUsername = new Map<string, string>();
    for (const ticket of input.tickets) {
      const hotspotUser = usersByUsername.get(ticket.username);
      const localMac = isMacAddress(ticket.mac_address ?? "")
        ? normalizeMacAddress(ticket.mac_address ?? "")
        : null;
      const routerMac = isMacAddress(hotspotUser?.macAddress ?? "")
        ? normalizeMacAddress(hotspotUser?.macAddress ?? "")
        : null;
      const expectedMac = localMac ?? routerMac;
      if (expectedMac) boundMacsByUsername.set(ticket.username, expectedMac);
    }

    for (const activeUser of input.activeUsers) {
      const ticket = ticketsByUsername.get(activeUser.username);
      const hotspotUser = usersByUsername.get(activeUser.username);
      if (!hotspotUser || !isMacAddress(activeUser.macAddress)) continue;
      // A voucher stored for another account or router is never touched.
      if (ticket && (ticket.account_id !== input.accountId || ticket.router_id !== input.routerId)) continue;
      // A TicketPro voucher absent from this computer's database (generated on
      // another computer, before a reinstall…) is still locked on RouterOS:
      // the rule applies to the router's vouchers, not only the local copies.
      if (!ticket && !(hotspotUser.comment ?? "").startsWith(TICKETPRO_VOUCHER_MARKER)) continue;

      const observedMac = normalizeMacAddress(activeUser.macAddress);
      const localMac = isMacAddress(ticket?.mac_address ?? "")
        ? normalizeMacAddress(ticket?.mac_address ?? "")
        : null;
      const routerMac = isMacAddress(hotspotUser.macAddress ?? "")
        ? normalizeMacAddress(hotspotUser.macAddress ?? "")
        : null;
      const expectedMac = boundMacsByUsername.get(activeUser.username) ??
        localMac ??
        routerMac;

      if (expectedMac && expectedMac !== observedMac) {
        result.conflicts.push({
          expectedMacAddress: expectedMac,
          observedMacAddress: observedMac,
          username: activeUser.username
        });
        continue;
      }

      try {
        if (routerMac !== observedMac) {
          // Only a RouterOS read-back proves the lock is applied.
          const verified = await input.routerService.bindHotspotUserToMac(
            activeUser.username,
            observedMac
          );
          const verifiedMac = isMacAddress(verified?.macAddress ?? "")
            ? normalizeMacAddress(verified?.macAddress ?? "")
            : null;
          if (verifiedMac !== observedMac) {
            throw new Error("RouterOS n'a pas conservé l'adresse MAC du voucher.");
          }
          result.verifiedUsers.push(verified);
          // Counted only when TicketPro wrote the lock itself; a voucher that
          // RouterOS already locked at login is not a new lock.
          result.boundUsernames.push(activeUser.username);
        }
        if (ticket) {
          await this.tickets.update({
            ...ticket,
            activated_at: ticket.activated_at ?? new Date().toISOString(),
            ip_address: activeUser.ipAddress,
            mac_address: observedMac,
            status: ticket.status === "désactivé" ? ticket.status : "activé",
            sync_status: "synced"
          });
        }
        boundMacsByUsername.set(activeUser.username, observedMac);
      } catch (error) {
        result.errors.push({
          message: error instanceof Error ? error.message : "Verrouillage impossible.",
          username: activeUser.username
        });
      }
    }

    return result;
  }

  async clear(input: {
    accountId: string;
    routerId: string;
    routerService: RouterService;
    ticket: TicketRecord;
  }): Promise<void> {
    if (
      input.ticket.account_id !== input.accountId ||
      input.ticket.router_id !== input.routerId
    ) {
      throw new Error("Ce voucher n’appartient pas au routeur actif.");
    }
    await input.routerService.clearHotspotUserMac(input.ticket.username);
    await this.tickets.update({
      ...input.ticket,
      ip_address: null,
      mac_address: null,
      sync_status: "synced"
    });
  }
}
