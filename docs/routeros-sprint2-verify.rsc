# TicketPro Sprint 2 - verification en lecture seule
# Ce script ne modifie aucune configuration RouterOS.

:put "=== TICKETPRO SPRINT 2 START ==="
:put "--- lifecycle script ---"
/system script print detail where name="ticketpro-voucher-expiration-v1"
:put "--- lifecycle scheduler ---"
/system scheduler print detail where name="ticketpro-voucher-expiration-v1"
:put "--- managed profile handlers ---"
/ip hotspot user profile print detail where on-login~"TICKETPRO-LIFECYCLE-BEGIN"
:put "--- TicketPro vouchers using default profile ---"
:put ("default-ticketpro-users=" . [:len [/ip hotspot user find where profile="default" and comment~"TicketPro:v1;"]])
:put "--- WireGuard interface ---"
/interface wireguard print detail where name="ticketpro-vpn"
:put "--- WireGuard peers ---"
/interface wireguard peers print detail where interface="ticketpro-vpn"
:put "--- WireGuard addresses ---"
/ip address print detail where interface="ticketpro-vpn"
:put "--- WireGuard routes ---"
/ip route print detail where gateway="ticketpro-vpn"
:put "--- TicketPro firewall ---"
/ip firewall filter print detail where comment~"TicketPro"
/ip firewall mangle print detail where comment~"TicketPro"
/ipv6 firewall filter print detail where comment~"TicketPro"
:put "--- TicketPro IP bindings ---"
/ip hotspot ip-binding print detail where comment~"TicketPro"
:put "--- dedicated management account ---"
/user group print detail where name="ticketpro-api"
/user print detail where name="ticketpro-api"
:put "--- management services ---"
/ip service print detail where !dynamic
:put "--- counts ---"
:put ("scripts=" . [:len [/system script find where name="ticketpro-voucher-expiration-v1"]])
:put ("schedulers=" . [:len [/system scheduler find where name="ticketpro-voucher-expiration-v1"]])
:put ("wg-interfaces=" . [:len [/interface wireguard find where name="ticketpro-vpn"]])
:put ("wg-peers=" . [:len [/interface wireguard peers find where interface="ticketpro-vpn"]])
:put ("wg-addresses=" . [:len [/ip address find where interface="ticketpro-vpn"]])
:put ("wg-routes=" . [:len [/ip route find where gateway="ticketpro-vpn"]])
:put ("wg-static-routes=" . [:len [/ip route find where gateway="ticketpro-vpn" and dynamic=no]])
:put "=== TICKETPRO SPRINT 2 END ==="
