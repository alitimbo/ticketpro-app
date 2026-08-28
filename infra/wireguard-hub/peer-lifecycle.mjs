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

export function rotateSharedPeers(
  tenants,
  {
    accountId,
    allowRevokedCurrent = false,
    peerType,
    previousPublicKey,
    publicKey,
    resourceId,
    rotatedAt = new Date().toISOString()
  }
) {
  const sources = [];
  for (const [tenantAccountId, tenant] of Object.entries(tenants)) {
    for (const peer of tenant.peers ?? []) {
      const isCurrentRevokedPeer = allowRevokedCurrent
        && tenantAccountId === accountId
        && peer.status === "revoked"
        && peer.resource_id === resourceId;
      if (
        peer.public_key === previousPublicKey
        && peer.peer_type === peerType
        && (["active", "disabled"].includes(peer.status) || isCurrentRevokedPeer)
      ) {
        sources.push({ accountId: tenantAccountId, peer, tenant });
      }
    }
  }

  const currentAlreadyRotated = (tenants[accountId]?.peers ?? []).find((peer) =>
    peer.public_key === publicKey
    && peer.peer_type === peerType
    && peer.resource_id === resourceId
    && peer.status === "active"
  ) ?? null;
  const currentSource = sources.find(({ accountId: sourceAccountId, peer }) =>
    sourceAccountId === accountId && peer.resource_id === resourceId
  );
  if (!currentSource && !currentAlreadyRotated) {
    throw new Error("shared_previous_peer_not_found");
  }

  const assignedAddresses = new Set(sources.map(({ peer }) => peer.assigned_address));
  if (currentAlreadyRotated) assignedAddresses.add(currentAlreadyRotated.assigned_address);
  if (assignedAddresses.size > 1) {
    throw new Error("shared_peer_address_mismatch");
  }

  const rotated = [];
  for (const source of sources) {
    const desiredStatus = source.peer.status === "revoked" ? "active" : source.peer.status;
    let replacement = (source.tenant.peers ?? []).find((peer) =>
      peer.public_key === publicKey && peer.peer_type === peerType
    );
    if (replacement && replacement.assigned_address !== source.peer.assigned_address) {
      throw new Error("shared_new_key_address_conflict");
    }
    if (!replacement) {
      replacement = {
        ...source.peer,
        created_at: rotatedAt,
        disabled_at: desiredStatus === "disabled" ? source.peer.disabled_at ?? rotatedAt : null,
        public_key: publicKey,
        revoked_at: null,
        status: desiredStatus
      };
      source.tenant.peers.push(replacement);
    } else {
      replacement.disabled_at = desiredStatus === "disabled"
        ? replacement.disabled_at ?? source.peer.disabled_at ?? rotatedAt
        : null;
      replacement.revoked_at = null;
      replacement.status = desiredStatus;
    }
    source.peer.status = "revoked";
    source.peer.revoked_at ||= rotatedAt;
    rotated.push({ account_id: source.accountId, peer: replacement });
  }

  const currentPeer = (tenants[accountId]?.peers ?? []).find((peer) =>
    peer.public_key === publicKey
    && peer.peer_type === peerType
    && peer.resource_id === resourceId
    && peer.status === "active"
  ) ?? currentAlreadyRotated;
  if (!currentPeer) throw new Error("shared_current_peer_not_active");
  return { currentPeer, rotated };
}
