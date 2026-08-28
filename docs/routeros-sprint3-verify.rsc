# TicketPro Sprint 3 - verification en lecture seule
# Ce script ne modifie aucune configuration RouterOS et n'affiche aucun mot de passe.

:put "=== TICKETPRO SPRINT 3 START ==="
:put "--- clock ---"
/system clock print
/system ntp client print

:put "--- lifecycle engine ---"
:foreach tpScriptId in=[/system script find where name="ticketpro-voucher-expiration-v1"] do={
  :put ("script=" . [/system script get $tpScriptId name] . ";comment=" . [/system script get $tpScriptId comment] . ";runs=" . [/system script get $tpScriptId run-count]);
}
:foreach tpSchedulerId in=[/system scheduler find where name="ticketpro-voucher-expiration-v1"] do={
  :put ("scheduler=" . [/system scheduler get $tpSchedulerId name] . ";disabled=" . [/system scheduler get $tpSchedulerId disabled] . ";interval=" . [/system scheduler get $tpSchedulerId interval] . ";runs=" . [/system scheduler get $tpSchedulerId run-count]);
}
:put ("scripts=" . [:len [/system script find where name="ticketpro-voucher-expiration-v1"]]);
:put ("schedulers=" . [:len [/system scheduler find where name="ticketpro-voucher-expiration-v1"]]);

:put "--- managed vouchers without secrets ---"
:foreach tpId in=[/ip hotspot user find where comment~"TicketPro:v1;"] do={
  :local tpUser [/ip hotspot user get $tpId name];
  :local tpBindingMarker ("TicketPro voucher:" . $tpUser);
  :put ("voucher=" . $tpUser . ";profile=" . [/ip hotspot user get $tpId profile] . ";disabled=" . [/ip hotspot user get $tpId disabled] . ";uptime=" . [/ip hotspot user get $tpId uptime] . ";limit-uptime=" . [/ip hotspot user get $tpId limit-uptime] . ";bytes-in=" . [/ip hotspot user get $tpId bytes-in] . ";bytes-out=" . [/ip hotspot user get $tpId bytes-out] . ";limit-bytes-total=" . [/ip hotspot user get $tpId limit-bytes-total] . ";comment=" . [/ip hotspot user get $tpId comment]);
  :put ("active=" . [:len [/ip hotspot active find where user=$tpUser]] . ";cookies=" . [:len [/ip hotspot cookie find where user=$tpUser]] . ";managed-bindings=" . [:len [/ip hotspot ip-binding find where comment~$tpBindingMarker]]);
}

:put "--- lifecycle events ---"
/log print where message~"TicketPro voucher"
:put "=== TICKETPRO SPRINT 3 END ==="
