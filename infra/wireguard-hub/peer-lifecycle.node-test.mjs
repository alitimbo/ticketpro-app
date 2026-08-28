import assert from "node:assert/strict";
import test from "node:test";
import {
  isIdempotentActivePeer,
  isPeerLimitReached,
  revokeDuplicateActivePeers,
  rotateSharedPeers,
  selectActivePeersToReplace,
  selectRevokedPeerForRecovery
} from "./peer-lifecycle.mjs";

test("une rotation cible uniquement la clé active de la même ressource et du même type", () => {
  const peers = [
    peer("old-router", "router", "router-1", "10.250.0.2/32"),
    peer("other-router", "router", "router-2", "10.250.0.3/32"),
    peer("operator", "operator", "router-1", "10.250.0.4/32")
  ];

  assert.deepEqual(
    selectActivePeersToReplace(peers, {
      peerType: "router",
      previousPublicKey: "old-router",
      publicKey: "new-router",
      resourceId: "router-1"
    }).map((item) => item.public_key),
    ["old-router"]
  );
});

test("les doublons historiques sont révoqués sans effacer leur historique", () => {
  const peers = [
    { ...peer("new", "router", "router-1", "10.250.0.2/32"), created_at: "2026-08-03T10:00:00Z" },
    { ...peer("old-resource", "router", "router-1", "10.250.0.3/32"), created_at: "2026-08-02T10:00:00Z" },
    { ...peer("old-address", "operator", "operator-1", "10.250.0.2/32"), created_at: "2026-08-01T10:00:00Z" }
  ];

  const revoked = revokeDuplicateActivePeers(peers, "2026-08-03T12:00:00Z");
  assert.deepEqual(revoked.map((item) => item.public_key), ["old-resource", "old-address"]);
  assert.equal(peers.length, 3);
  assert.equal(peers[0].status, "active");
  assert.equal(peers[1].revoked_at, "2026-08-03T12:00:00Z");
});

test("un pair actif existant reste idempotent même si la limite a ensuite baissé", () => {
  const existing = peer("device-key", "operator", "device:pc-1", "10.250.0.5/32");
  assert.equal(isIdempotentActivePeer(existing, {
    peerType: "operator",
    publicKey: "device-key",
    resourceId: "device:pc-1"
  }), true);
  assert.equal(isIdempotentActivePeer(existing, {
    peerType: "operator",
    publicKey: "another-key",
    resourceId: "device:pc-2"
  }), false);
});

test("une limite opérateur nulle autorise le mode illimité", () => {
  assert.equal(isPeerLimitReached(100_000, null), false);
  assert.equal(isPeerLimitReached(5, 5), true);
  assert.equal(isPeerLimitReached(4, 5), false);
});

test("une rotation de récupération cible uniquement la clé révoquée du même appareil", () => {
  const revoked = {
    ...peer("revoked-device-key", "operator", "device:pc-1", "10.250.1.5/32"),
    status: "revoked"
  };
  const peers = [
    revoked,
    { ...peer("other-key", "operator", "device:pc-2", "10.250.1.6/32"), status: "revoked" }
  ];

  assert.equal(selectRevokedPeerForRecovery(peers, {
    peerType: "operator",
    previousPublicKey: "revoked-device-key",
    resourceId: "device:pc-1"
  }), revoked);
  assert.equal(selectRevokedPeerForRecovery(peers, {
    peerType: "operator",
    previousPublicKey: "revoked-device-key",
    resourceId: "device:pc-2"
  }), null);
});

test("une rotation partagée conserve les accès actifs et suspendus de toutes les organisations", () => {
  const tenants = {
    organizationA: {
      peers: [peer("old-device-key", "operator", "device:a", "10.250.0.5/32")]
    },
    organizationB: {
      peers: [{
        ...peer("old-device-key", "operator", "device:b", "10.250.0.5/32"),
        status: "disabled"
      }]
    }
  };

  const result = rotateSharedPeers(tenants, {
    accountId: "organizationA",
    peerType: "operator",
    previousPublicKey: "old-device-key",
    publicKey: "new-device-key",
    resourceId: "device:a",
    rotatedAt: "2026-08-27T01:00:00Z"
  });

  assert.equal(result.currentPeer.public_key, "new-device-key");
  assert.equal(result.rotated.length, 2);
  assert.equal(tenants.organizationA.peers.find((item) => item.public_key === "old-device-key").status, "revoked");
  assert.equal(tenants.organizationA.peers.find((item) => item.public_key === "new-device-key").status, "active");
  assert.equal(tenants.organizationB.peers.find((item) => item.public_key === "new-device-key").status, "disabled");
});

test("une rotation partagée refuse deux adresses pour la même identité physique", () => {
  const tenants = {
    organizationA: {
      peers: [peer("old-device-key", "operator", "device:a", "10.250.0.5/32")]
    },
    organizationB: {
      peers: [peer("old-device-key", "operator", "device:b", "10.250.1.5/32")]
    }
  };

  assert.throws(() => rotateSharedPeers(tenants, {
    accountId: "organizationA",
    peerType: "operator",
    previousPublicKey: "old-device-key",
    publicKey: "new-device-key",
    resourceId: "device:a"
  }), /shared_peer_address_mismatch/);
});

function peer(publicKey, peerType, resourceId, assignedAddress) {
  return {
    assigned_address: assignedAddress,
    created_at: "2026-08-03T00:00:00Z",
    peer_type: peerType,
    public_key: publicKey,
    resource_id: resourceId,
    status: "active"
  };
}
