# TicketPro Sprint 4 - read-only synchronization verification
# This script never changes RouterOS and never prints passwords.

:put "=== TICKETPRO SPRINT 4 START ==="
:put "--- clock and NTP ---"
/system clock print
/system ntp client print

:put "--- lifecycle engine ---"
:put ("scripts=" . [:len [/system script find where name="ticketpro-voucher-expiration-v1"]])
:put ("schedulers=" . [:len [/system scheduler find where name="ticketpro-voucher-expiration-v1"]])
:foreach tpSchedulerId in=[/system scheduler find where name="ticketpro-voucher-expiration-v1"] do={
  :put ("scheduler-disabled=" . [/system scheduler get $tpSchedulerId disabled] . ";interval=" . [/system scheduler get $tpSchedulerId interval] . ";runs=" . [/system scheduler get $tpSchedulerId run-count])
}

:put "--- managed voucher consistency ---"
{
  :local tpManagedIds [/ip hotspot user find where comment~"TicketPro:v1;"]
  :local tpDuplicateEntries 0
  :local tpDisabled 0
  :local tpCleanupErrors 0
  :put ("managed-vouchers=" . [:len $tpManagedIds])
  :foreach tpId in=$tpManagedIds do={
    :local tpName [/ip hotspot user get $tpId name]
    :local tpComment [/ip hotspot user get $tpId comment]
    :local tpIsDisabled [/ip hotspot user get $tpId disabled]
    :if ($tpIsDisabled = true) do={ :set tpDisabled ($tpDisabled + 1) }
    :if ([:len [/ip hotspot user find where name=$tpName]] > 1) do={
      :set tpDuplicateEntries ($tpDuplicateEntries + 1)
      :put ("DUPLICATE-VOUCHER=" . $tpName)
    }
    :if ([:typeof [:find $tpComment "state=cleanup-error;"]] != "nil") do={
      :set tpCleanupErrors ($tpCleanupErrors + 1)
      :put ("CLEANUP-ERROR=" . $tpName)
    }
  }
  :put ("disabled-managed-vouchers=" . $tpDisabled)
  :put ("duplicate-voucher-entries=" . $tpDuplicateEntries)
  :put ("cleanup-errors=" . $tpCleanupErrors)
}

:put "--- active sessions and cookies ---"
:put ("active-hotspot-sessions=" . [:len [/ip hotspot active find]])
:put ("hotspot-cookies=" . [:len [/ip hotspot cookie find]])
:put ("ticketpro-voucher-bindings=" . [:len [/ip hotspot ip-binding find where comment~"TicketPro voucher:"]])

:put "--- WireGuard observation ---"
:put ("wg-interfaces=" . [:len [/interface wireguard find where name="ticketpro-vpn"]])
:put ("wg-peers=" . [:len [/interface wireguard peers find where interface="ticketpro-vpn"]])
:foreach tpPeerId in=[/interface wireguard peers find where interface="ticketpro-vpn"] do={
  :put ("peer-disabled=" . [/interface wireguard peers get $tpPeerId disabled] . ";last-handshake=" . [/interface wireguard peers get $tpPeerId last-handshake] . ";rx=" . [/interface wireguard peers get $tpPeerId rx] . ";tx=" . [/interface wireguard peers get $tpPeerId tx])
}

:put "--- recent TicketPro lifecycle errors ---"
/log print where message~"TicketPro voucher" and topics~"error"
:put "=== TICKETPRO SPRINT 4 END ==="
