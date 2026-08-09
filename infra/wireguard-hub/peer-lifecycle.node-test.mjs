import assert from "node:assert/strict";
import test from "node:test";
import {
  revokeDuplicateActivePeers,
  selectActivePeersToReplace
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
