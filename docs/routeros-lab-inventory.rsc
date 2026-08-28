# TicketPro — inventaire RouterOS en lecture seule
# Exécuter depuis le terminal WinBox, puis copier la sortie dans un fichier daté.
# Ce script ne modifie aucune configuration.

:put "=== TICKETPRO INVENTORY START ==="
/system identity print
/system resource print
/system clock print
/system ntp client print
/system ntp client servers print
/ip service print detail where !dynamic
/interface wireguard print detail
/interface wireguard peers print detail
/ip address print detail where interface="ticketpro-vpn"
/ip route print detail where dst-address="10.250.0.0/16"
/ip hotspot print detail
/ip hotspot profile print detail
/ip hotspot user profile print detail
/system script print detail where name~"ticketpro"
/system scheduler print detail where name~"ticketpro"
/ip firewall filter print detail where comment~"TicketPro"
/ip firewall mangle print detail where comment~"TicketPro"
/ipv6 firewall filter print detail where comment~"TicketPro"
/ip hotspot ip-binding print detail where comment~"TicketPro"
:put "=== COUNTS ==="
:put ("hotspot-users=" . [:len [/ip hotspot user find]])
:put ("ticketpro-vouchers=" . [:len [/ip hotspot user find where comment~"TicketPro:v1;"]])
:put ("ticketpro-vouchers-new=" . [:len [/ip hotspot user find where comment~"state=new"]])
:put ("ticketpro-vouchers-active=" . [:len [/ip hotspot user find where comment~"state=active"]])
:put ("ticketpro-vouchers-exhausted=" . [:len [/ip hotspot user find where comment~"state=exhausted"]])
:put ("ticketpro-vouchers-expired=" . [:len [/ip hotspot user find where comment~"state=expired"]])
:put ("ticketpro-vouchers-cleanup-error=" . [:len [/ip hotspot user find where comment~"state=cleanup-error"]])
:put ("active-users=" . [:len [/ip hotspot active find]])
:put ("hotspot-cookies=" . [:len [/ip hotspot cookie find]])
:put ("ticketpro-scripts=" . [:len [/system script find where name~"ticketpro"]])
:put ("ticketpro-schedulers=" . [:len [/system scheduler find where name~"ticketpro"]])
:put "=== TICKETPRO INVENTORY END ==="
