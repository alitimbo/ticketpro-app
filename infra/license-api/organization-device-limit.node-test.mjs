import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrganizationDeviceLimit, organizationHubOperatorLimit } from "./organization-device-limit.mjs";

test("hérite du forfait en absence de dérogation", () => {
  assert.deepEqual(resolveOrganizationDeviceLimit(null, { max_devices: 2, device_limit_mode: "limited" }), { mode: "limited", maxDevices: 2, source: "plan" });
  assert.equal(resolveOrganizationDeviceLimit({ mode: "inherit" }, { max_devices: 10 }).maxDevices, 10);
  assert.equal(resolveOrganizationDeviceLimit(null, null).maxDevices, 0);
});
test("une limite organisation remplace uniquement le quota PC", () => {
  const subscription = { max_devices: 2, router_limit: 150, amount: 5000, device_limit_mode: "limited" };
  assert.deepEqual(resolveOrganizationDeviceLimit({ mode: "limited", max_devices: 7 }, subscription), { mode: "limited", maxDevices: 7, source: "organization" });
  assert.equal(subscription.max_devices, 2);
  assert.equal(subscription.router_limit, 150);
});
test("illimité reste null et une dérogation limitée peut restreindre un forfait illimité", () => {
  assert.equal(resolveOrganizationDeviceLimit({ mode: "unlimited" }, { max_devices: 2 }).maxDevices, null);
  assert.equal(resolveOrganizationDeviceLimit(null, { max_devices: 1, device_limit_mode: "unlimited" }).maxDevices, null);
  assert.equal(resolveOrganizationDeviceLimit({ mode: "limited", max_devices: 3 }, { device_limit_mode: "unlimited" }).maxDevices, 3);
});
test("le plafond hub préserve les postes existants et ajoute les collaborateurs", () => {
  assert.equal(organizationHubOperatorLimit(2, 5, 3), 8);
  assert.equal(organizationHubOperatorLimit(10, 5, 3), 13);
  assert.equal(organizationHubOperatorLimit(null, 5, 3), null);
});
