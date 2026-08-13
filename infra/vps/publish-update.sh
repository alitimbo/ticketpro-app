#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "Utilisation : $0 <setup.exe> <setup.exe.sig> <stable.json>" >&2
  exit 1
fi

INSTALLER=$1
SIGNATURE=$2
MANIFEST=$3
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASES_DIR=$(sed -n 's/^TICKETPRO_RELEASES_DIR=//p' "$SCRIPT_DIR/.env" 2>/dev/null | tail -n 1)
RELEASES_DIR=${RELEASES_DIR:-/opt/ticketpro/releases}
INSTALLER_NAME=$(basename "$INSTALLER")

for file in "$INSTALLER" "$SIGNATURE" "$MANIFEST"; do
  if [ ! -f "$file" ]; then
    echo "Fichier introuvable : $file" >&2
    exit 1
  fi
done

if ! printf '%s' "$INSTALLER_NAME" | grep -Eq '^TicketPro-Setup-[0-9A-Za-z.-]+-x64\.exe$'; then
  echo "Nom d'installateur TicketPro invalide : $INSTALLER_NAME" >&2
  exit 1
fi

install -d -m 755 "$RELEASES_DIR"
install -m 644 "$INSTALLER" "$RELEASES_DIR/$INSTALLER_NAME"
install -m 644 "$SIGNATURE" "$RELEASES_DIR/$(basename "$SIGNATURE")"
(
  cd "$RELEASES_DIR"
  sha256sum "$INSTALLER_NAME" > "$INSTALLER_NAME.sha256"
)
docker exec ticketpro-license-api mkdir -p /data/app-updates
docker cp "$MANIFEST" ticketpro-license-api:/data/app-updates/stable.json

if grep -q '^TICKETPRO_LATEST_WINDOWS_SETUP=' "$SCRIPT_DIR/.env"; then
  sed -i "s|^TICKETPRO_LATEST_WINDOWS_SETUP=.*$|TICKETPRO_LATEST_WINDOWS_SETUP=$INSTALLER_NAME|" "$SCRIPT_DIR/.env"
else
  printf '\nTICKETPRO_LATEST_WINDOWS_SETUP=%s\n' "$INSTALLER_NAME" >> "$SCRIPT_DIR/.env"
fi
chmod 600 "$SCRIPT_DIR/.env"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" \
  --project-directory "$SCRIPT_DIR" up -d --force-recreate reverse-proxy

echo "Mise à jour publiée."
echo "Installateur : $RELEASES_DIR/$INSTALLER_NAME"
echo "Manifeste : /data/app-updates/stable.json"
echo "Téléchargement officiel : https://$(sed -n 's/^API_DOMAIN=//p' "$SCRIPT_DIR/.env" | tail -n 1)/download/windows"
