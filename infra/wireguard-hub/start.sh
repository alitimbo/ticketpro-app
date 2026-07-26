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

if [ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)" != "1" ]; then
  echo "net.ipv4.ip_forward doit être activé sur le VPS" >&2
  exit 1
fi

while iptables -D FORWARD -i wg0 -o wg0 -j ACCEPT 2>/dev/null; do :; done

exec node /app/server.mjs
