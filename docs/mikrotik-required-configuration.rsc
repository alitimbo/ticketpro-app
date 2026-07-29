# TicketPro — vérification minimale RouterOS 7
# Adapter l'adresse du réseau d'administration avant exécution.

/ip/service/enable api
/ip/service/set api port=8728

# Recommandé après validation : limiter l'API au LAN d'administration
# et au pool WireGuard TicketPro, par exemple :
# /ip/service/set api address=192.168.88.0/24,10.250.0.0/16

/system/resource/print
/ip/hotspot/print
/ip/hotspot/user/profile/print
