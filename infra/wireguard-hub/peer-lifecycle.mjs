export function selectActivePeersToReplace(
  peers,
  { peerType, previousPublicKey, publicKey, resourceId }
) {
  return peers.filter((peer) =>
    peer.status === "active"
    && peer.peer_type === peerType
    && peer.public_key !== publicKey
    && (
      peer.resource_id === resourceId
      || (previousPublicKey && peer.public_key === previousPublicKey)
    )
  );
}

export function selectRevokedPeerForRecovery(
  peers,
  { peerType, previousPublicKey, resourceId }
) {
  return peers.find((peer) =>
    peer.status === "revoked"
    && peer.peer_type === peerType
    && peer.public_key === previousPublicKey
    && peer.resource_id === resourceId
  ) ?? null;
}

export function isIdempotentActivePeer(existing, { peerType, publicKey, resourceId }) {
  return Boolean(
    existing
    && existing.status === "active"
    && existing.peer_type === peerType
    && existing.public_key === publicKey
    && existing.resource_id === resourceId
  );
}

export function isPeerLimitReached(activePeerCount, limit) {
  return limit !== null && activePeerCount >= limit;
}

export function revokeDuplicateActivePeers(peers, revokedAt = new Date().toISOString()) {
  const activePeers = peers
    .filter((peer) => peer.status === "active")
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  const resources = new Set();
  const addresses = new Set();
  const revoked = [];
  for (const peer of activePeers) {
    const resourceKey = `${peer.peer_type}:${peer.resource_id}`;
    if (resources.has(resourceKey) || addresses.has(peer.assigned_address)) {
      peer.status = "revoked";
      peer.revoked_at ||= revokedAt;
      revoked.push(peer);
      continue;
    }
    resources.add(resourceKey);
    addresses.add(peer.assigned_address);
  }
  return revoked;
}
