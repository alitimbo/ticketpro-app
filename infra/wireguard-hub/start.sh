#!/bin/sh
set -eu

if [ ! -f /etc/wireguard/wg0.conf ]; then
  echo "Configuration /etc/wireguard/wg0.conf absente" >&2
  exit 1
fi

if ! wg show wg0 >/dev/null 2>&1; then
  wg-quick up wg0
else
  wg-quick strip wg0 > /tmp/wg0-stripped.conf
  wg syncconf wg0 /tmp/wg0-stripped.conf
  rm -f /tmp/wg0-stripped.conf
fi

# `wg syncconf` restaure la configuration cryptographique mais ne remonte pas
# une interface existante qui a ete laissee administrativement DOWN (par
# exemple apres un redemarrage du VPS ou un ancien arret incomplet). Sans cette
# instruction, le hub conserve ses peers et son port tout en ignorant les
# handshakes entrants.
ip link set dev wg0 up

if [ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)" != "1" ]; then
  echo "net.ipv4.ip_forward doit être activé sur le VPS" >&2
  exit 1
fi

while iptables -D FORWARD -i wg0 -o wg0 -j ACCEPT 2>/dev/null; do :; done

# Les reponses RouterOS volumineuses (liste des vouchers, sessions) traversent
# deux tunnels WireGuard : poste -> VPS -> routeur. Sur un lien PPPoE ou 4G, un
# segment TCP plein depasse le MTU reel et se perd sans erreur : les petites
# requetes passent (le routeur parait en ligne) mais les grandes listes ne
# finissent jamais de charger. Le MSS des connexions TCP relayees par wg0 est
# donc borne a une valeur sure pour tous les liens (IPv4 1280 octets) ; un MSS
# deja plus petit n'est jamais augmente.
TICKETPRO_WG_TCP_MSS="${TICKETPRO_WG_TCP_MSS:-1240}"
for direction in "-i wg0" "-o wg0"; do
  # shellcheck disable=SC2086
  while iptables -t mangle -D FORWARD $direction -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss "$((TICKETPRO_WG_TCP_MSS + 1)):65535" -j TCPMSS --set-mss "$TICKETPRO_WG_TCP_MSS" 2>/dev/null; do :; done
  # shellcheck disable=SC2086
  iptables -t mangle -A FORWARD $direction -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss "$((TICKETPRO_WG_TCP_MSS + 1)):65535" -j TCPMSS --set-mss "$TICKETPRO_WG_TCP_MSS"
done

exec node /app/server.mjs
