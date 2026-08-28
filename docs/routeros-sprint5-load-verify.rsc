# TicketPro Sprint 5 - read-only load verification
# This script never changes RouterOS and never prints passwords.

:put "=== TICKETPRO SPRINT 5 LOAD START ==="
:put "--- system resources ---"
/system resource print
:put "--- clock and NTP ---"
/system clock print
/system ntp client print

:put "--- voucher load counters ---"
{
  :local tpManaged [:len [/ip hotspot user find where comment~"TicketPro:v1;"]]
  :local tpOwned [:len [/ip hotspot user find where comment~";batch="]]
  :local tpSprint5 [:len [/ip hotspot user find where name~"^S5"]]
  :local tpCleanupErrors [:len [/ip hotspot user find where comment~"state=cleanup-error;"]]
  :put ("managed-vouchers=" . $tpManaged)
  :put ("owned-vouchers=" . $tpOwned)
  :put ("sprint5-vouchers=" . $tpSprint5)
  :put ("cleanup-errors=" . $tpCleanupErrors)
}
:put ("active-hotspot-sessions=" . [:len [/ip hotspot active find]])
:put ("hotspot-cookies=" . [:len [/ip hotspot cookie find]])

:put "--- lifecycle engine ---"
/system script print detail where name="ticketpro-voucher-expiration-v1"
/system scheduler print detail where name="ticketpro-voucher-expiration-v1"

:put "--- WireGuard observation ---"
/interface wireguard peers print detail where interface="ticketpro-vpn"

:put "--- recent TicketPro errors ---"
/log print where topics~"error" and message~"TicketPro"
:put "=== TICKETPRO SPRINT 5 LOAD END ==="
