import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Ban,
  Network,
  Plus,
  RadioTower,
  Save,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import type { RouterRecord } from "../../domain/database";
import {
  RouterConnectionRepository,
  RouterManagedResourceManifestRepository,
  RouterRepository,
  useAppDatabase
} from "../../services/database";
import {
  defaultRouterAccessPolicy,
  normalizeMacAddress,
  routerAccessPolicyCloudId,
  RouterAccessPolicySyncService,
  validateRouterAccessPolicy,
  type InfrastructureDevice,
  type BlockedDevice,
  type RouterAccessPolicy,
  type RouterAccessPolicySyncStatus
} from "../../services/access";
import {
  createPersistedRouterService,
  RouterManagementSecurityService,
  RouterServiceError,
  type PreparedRouterManagementSecurity
} from "../../services/router";
import { RouterCloudRecoveryService } from "../../services/recovery";
import { encryptLocalSecret } from "../../services/security/localSecrets";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataListItem,
  PageHeader,
  PasswordField,
  StatusDot
} from "../../shared/ui";
import {
  canEditRouterSensitiveSettings,
  antiTetheringCoverageIssues,
  antiTetheringCoverageSummary,
  canViewRouterSettings,
  defaultRouterSettings,
  mergeRouterManagementSecurityManifest,
  routerManagementSecurityAuditState,
  routerRecordToSettings,
  validateRouterSettings,
  type RouterManagementSecurityAuditState,
  type RouterSettings
} from "./routerSettingsPageModel";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

const emptyInfrastructureDevice: Omit<InfrastructureDevice, "id"> = {
  internetBypass: true,
  ipAddress: "",
  macAddress: "",
  mode: "bridge",
  name: "",
  type: "antenna"
};

const emptyBlockedDevice: Omit<BlockedDevice, "id"> = {
  ipAddress: "",
  macAddress: "",
  name: ""
};

export function RouterSettingsPage() {
  const { saasAccount, session } = useAuth();
  const sessionAccountId = session?.account_id ?? null;
  const sessionProfileId = session?.internal_profile_id ?? null;
  const { routerId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const shouldFocusAntiSharing = searchParams.get("section") === "anti-partage";
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canView = canViewRouterSettings(session?.internal_profile_role);
  const canEditSensitive = canEditRouterSensitiveSettings(session?.internal_profile_role);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const managedResourceManifestRepository = useMemo(
    () => new RouterManagedResourceManifestRepository(database),
    [database]
  );
  const accessPolicySyncService = useMemo(
    () => new RouterAccessPolicySyncService(database),
    [database]
  );
  const recoveryService = useMemo(
    () => sessionAccountId && sessionProfileId
      ? new RouterCloudRecoveryService(
          database,
          sessionAccountId,
          sessionProfileId,
          undefined,
          saasAccount?.organization.id ?? null
        )
      : null,
    [database, saasAccount?.organization.id, sessionAccountId, sessionProfileId]
  );
  const [router, setRouter] = useState<RouterRecord | null>(null);
  const [settings, setSettings] = useState<RouterSettings>(defaultRouterSettings);
  const [accessPolicy, setAccessPolicy] = useState<RouterAccessPolicy>(() =>
    structuredClone(defaultRouterAccessPolicy)
  );
  const [savedAccessPolicy, setSavedAccessPolicy] = useState<RouterAccessPolicy>(() =>
    structuredClone(defaultRouterAccessPolicy)
  );
  const [accessPolicySyncStatus, setAccessPolicySyncStatus] =
    useState<RouterAccessPolicySyncStatus>("offline");
  const [cloudRouterId, setCloudRouterId] = useState(routerId);
  const [conflictingRemotePolicy, setConflictingRemotePolicy] =
    useState<{ policy: RouterAccessPolicy; revision: number } | null>(null);
  const [infrastructureDraft, setInfrastructureDraft] = useState(emptyInfrastructureDevice);
  const [infrastructureDraftError, setInfrastructureDraftError] = useState<string | null>(null);
  const [blockedDeviceDraft, setBlockedDeviceDraft] = useState(emptyBlockedDevice);
  const [blockedDeviceDraftError, setBlockedDeviceDraftError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testMessage, setTestMessage] = useState("Non testé");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAccessPolicy, setIsSavingAccessPolicy] = useState(false);
  const [antiTetheringCheck, setAntiTetheringCheck] = useState<{ issues: string[]; summary: string | null } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [managementSecurity, setManagementSecurity] =
    useState<PreparedRouterManagementSecurity | null>(null);
  const [isPreparingManagementSecurity, setIsPreparingManagementSecurity] = useState(false);
  const [isApplyingManagementSecurity, setIsApplyingManagementSecurity] = useState(false);
  const [managementSecurityApplied, setManagementSecurityApplied] = useState(false);
  const [managementSecurityAudit, setManagementSecurityAudit] =
    useState<RouterManagementSecurityAuditState>("unknown");
  const [managementSecurityObservedAt, setManagementSecurityObservedAt] = useState<string | null>(null);
  const [managementSecurityConfirmationOpen, setManagementSecurityConfirmationOpen] = useState(false);
  const managementSecurityWorkflowRef = useRef<RouterManagementSecurityService | null>(null);

  useEffect(() => {
    if (!isInitialized || !sessionAccountId || !routerId) {
      return undefined;
    }

    let mounted = true;

    void (async () => {
      try {
        const record = await routerRepository.findById(routerId);
        if (!mounted) return;
        if (!record || record.deleted_at || record.account_id !== sessionAccountId) {
          setFeedback({ kind: "error", text: "Routeur introuvable pour cette organisation." });
          setIsLoading(false);
          return;
        }
        const connections = await connectionRepository.listByRouter(routerId);
        const stableCloudRouterId = routerAccessPolicyCloudId(record, connections);
        const policySync = await accessPolicySyncService.load(
          sessionAccountId,
          routerId,
          stableCloudRouterId
        );
        let securityAudit: RouterManagementSecurityAuditState = "unknown";
        let securityObservedAt: string | null = null;
        try {
          const storedManifest = await managedResourceManifestRepository.findByRouter(routerId);
          securityAudit = routerManagementSecurityAuditState(storedManifest?.manifest ?? null);
          securityObservedAt = storedManifest?.record.observed_at ?? null;
        } catch {
          // A missing or unreadable diagnostic must never prevent the router
          // settings themselves from loading.
        }
        if (!mounted) return;
        setRouter(record);
        setSettings(routerRecordToSettings(record));
        managementSecurityWorkflowRef.current = null;
        setManagementSecurity(null);
        setManagementSecurityAudit(securityAudit);
        setManagementSecurityApplied(false);
        setManagementSecurityObservedAt(securityObservedAt);
        setCloudRouterId(stableCloudRouterId);
        setAccessPolicy(policySync.policy);
        setSavedAccessPolicy(structuredClone(policySync.policy));
        setAccessPolicySyncStatus(policySync.status);
        setConflictingRemotePolicy(
          policySync.status === "conflict" && policySync.remotePolicy
            ? { policy: policySync.remotePolicy, revision: policySync.revision }
            : null
        );
        setIsLoading(false);
      } catch (error) {
        if (!mounted) return;
        setFeedback({
          kind: "error",
          text: error instanceof Error ? error.message : "Impossible de charger les paramètres du routeur."
        });
        setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    accessPolicySyncService,
    connectionRepository,
    isInitialized,
    managedResourceManifestRepository,
    routerId,
    routerRepository,
    sessionAccountId
  ]);

  useEffect(() => {
    if (isLoading || !shouldFocusAntiSharing) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById("controle-acces-anti-partage");
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
      section?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isLoading, shouldFocusAntiSharing]);

  const updateSettings = (partial: Partial<RouterSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
    if (hasManagementConnectionChanges(partial)) {
      managementSecurityWorkflowRef.current = null;
      setManagementSecurity(null);
      setManagementSecurityApplied(false);
      setManagementSecurityAudit("unknown");
      setManagementSecurityObservedAt(null);
    }
    setFeedback(null);
    setTestMessage("À retester");
  };

  const saveSettings = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut modifier ces paramètres." });
      return;
    }

    const validationError = validateRouterSettings(settings);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const encryptedPassword = settings.password.trim()
        ? await encryptLocalSecret(settings.password)
        : router.encrypted_password;
      const name = settings.name.trim();
      const updated = await routerRepository.update({
        ...router,
        api_port: Number(settings.apiPort),
        api_ssl_port: Number(settings.apiSslPort),
        connection_mode: settings.connectionMode,
        encrypted_password: encryptedPassword,
        hotspot_address: settings.hotspotAddress.trim(),
        label: name,
        local_ip: settings.ipAddress.trim(),
        name,
        sync_status: "local",
        username: settings.username.trim()
      });

      setRouter(updated);
      setSettings(routerRecordToSettings(updated));
      let cloudBackupPending = false;
      try {
        await recoveryService?.backupRouter(updated.id);
      } catch {
        cloudBackupPending = true;
      }
      setFeedback({
        kind: "success",
        text: cloudBackupPending
          ? "Paramètres enregistrés localement. La sauvegarde VPS sera retentée à la prochaine connexion."
          : "Paramètres enregistrés localement et sauvegardés sur le VPS."
      });
      setTestMessage("À retester");
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "L'enregistrement des paramètres a échoué."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    if (!router || !session) {
      setFeedback({ kind: "error", text: "Le routeur n'est pas encore chargé." });
      return;
    }

    if (hasUnsavedConnectionChanges(router, settings)) {
      setFeedback({
        kind: "error",
        text: "Enregistrez d'abord les modifications de connexion, puis relancez le test."
      });
      return;
    }

    setIsTesting(true);
    setFeedback(null);

    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      const result = await service.testConnection();

      if (connections.some((connection) => connection.mode === result.mode)) {
        await routerRepository.recordConnectionTest({
          accountId: session.account_id,
          checkedAt: result.checkedAt,
          errorMessage: null,
          internalProfileId: session.internal_profile_id,
          mode: result.mode,
          routerId: router.id,
          status: "connected"
        });
      }
      setRouter((current) => current ? { ...current, last_seen_at: result.checkedAt, status: "active" } : current);
      setTestMessage("Routeur connecté");
      setFeedback({ kind: "success", text: `Connexion RouterOS réussie en mode ${result.mode}.` });
    } catch (error) {
      const detail = error instanceof RouterServiceError || error instanceof Error
        ? error.message
        : "Test impossible.";
      setTestMessage("Connexion échouée");
      setFeedback({ kind: "error", text: detail });
    } finally {
      setIsTesting(false);
    }
  };

  const updateAccessPolicy = (partial: Partial<RouterAccessPolicy>) => {
    setAccessPolicy((current) => ({ ...current, ...partial }));
    setFeedback(null);
  };

  const updateInfrastructureDraft = (
    partial: Partial<Omit<InfrastructureDevice, "id">>
  ) => {
    setInfrastructureDraft((current) => ({ ...current, ...partial }));
    setInfrastructureDraftError(null);
    setFeedback(null);
  };

  const addInfrastructureDevice = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut ajouter un bypass." });
      return;
    }
    const device: InfrastructureDevice = {
      ...infrastructureDraft,
      id: globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ipAddress: infrastructureDraft.ipAddress.trim(),
      macAddress: normalizeMacAddress(infrastructureDraft.macAddress),
      mode: "bridge",
      name: infrastructureDraft.name.trim()
    };
    const duplicate = accessPolicy.infrastructureDevices.find((item) =>
      item.id === device.id
      || normalizeMacAddress(item.macAddress) === device.macAddress
      || item.ipAddress === device.ipAddress
    );
    if (duplicate) {
      const message = `Équipement déjà présent : ${duplicate.name}.`;
      setInfrastructureDraftError(message);
      setFeedback({ kind: "error", text: message });
      return;
    }
    const candidate = {
      ...accessPolicy,
      infrastructureDevices: [...accessPolicy.infrastructureDevices, device]
    };
    const validationError = validateRouterAccessPolicy(candidate);
    if (validationError) {
      setInfrastructureDraftError(validationError);
      setFeedback({ kind: "error", text: validationError });
      return;
    }
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      let outcome: "already_present" | "created" | "updated" = "created";
      if (device.internetBypass) {
        const connections = await connectionRepository.listByRouter(router.id);
        const service = await createPersistedRouterService({
          authSession: session,
          connections,
          database,
          router
        });
        const result = await service.upsertHotspotBypass({
          address: device.ipAddress,
          comment: `${device.name} (${device.type})`,
          id: device.id,
          macAddress: device.macAddress
        });
        outcome = result.outcome === "updated" || result.outcome === "already_present"
          ? result.outcome
          : "created";
      }
      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        candidate,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setInfrastructureDraft(emptyInfrastructureDevice);
      setInfrastructureDraftError(null);
      setFeedback({
        kind: syncResult.status === "conflict" ? "error" : "success",
        text: syncResult.status === "conflict"
          ? `${device.name} est appliqué sur RouterOS et localement, mais un conflit VPS doit être résolu.`
          : syncResult.status !== "synced"
            ? `${device.name} est appliqué sur RouterOS et localement. Le VPS sera synchronisé au retour du réseau.`
            : outcome === "already_present"
              ? `${device.name} était déjà présent sur le MikroTik. La configuration locale et VPS a été resynchronisée.`
              : outcome === "updated"
                ? `${device.name} a été mis à jour sur RouterOS, localement et sur le VPS.`
                : `${device.name} a été ajouté en bypass sur RouterOS, localement et sur le VPS.`
      });
    } catch (error) {
      setFeedback({ kind: "error", text: accessActionError(error, `Impossible d'ajouter ${device.name}.`) });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const prepareManagementSecurity = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut préparer le compte RouterOS dédié." });
      return;
    }
    if (hasUnsavedConnectionChanges(router, settings)) {
      setFeedback({
        kind: "error",
        text: "Enregistrez et testez d'abord les paramètres de connexion actuels."
      });
      return;
    }

    setIsPreparingManagementSecurity(true);
    setManagementSecurity(null);
    setManagementSecurityApplied(false);
    setFeedback(null);

    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const currentClient = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      const workflow = new RouterManagementSecurityService({
        currentClient,
        createCandidateClient: async (credentials) => {
          const encryptedPassword = await encryptLocalSecret(credentials.password);
          return createPersistedRouterService({
            authSession: session,
            connections,
            database,
            logActions: false,
            router: {
              ...router,
              encrypted_password: encryptedPassword,
              username: credentials.username
            }
          });
        },
        commitCredentials: async (credentials) => {
          const encryptedPassword = await encryptLocalSecret(credentials.password);
          const updated = await routerRepository.update({
            ...router,
            encrypted_password: encryptedPassword,
            sync_status: "local",
            username: credentials.username
          });
          setRouter(updated);
          setSettings(routerRecordToSettings(updated));
          try {
            await recoveryService?.backupRouter(updated.id);
          } catch {
            // The local credentials are authoritative for the current device.
            // Cloud backup will retry through the regular recovery workflow.
          }
        }
      });
      const prepared = router.username === "ticketpro-api"
        ? await workflow.prepareExisting({
            localRouterIp: router.local_ip,
            username: router.username
          })
        : await workflow.prepare({ localRouterIp: router.local_ip });
      managementSecurityWorkflowRef.current = workflow;
      setManagementSecurity(prepared);
      setFeedback({
        kind: "success",
        text: `Le compte ${prepared.username} a été créé et testé en mode ${prepared.connectionMode}. Aucune restriction n'est encore appliquée.`
      });
    } catch (error) {
      managementSecurityWorkflowRef.current = null;
      setFeedback({
        kind: "error",
        text: accessActionError(error, "Impossible de préparer le compte RouterOS dédié.")
      });
    } finally {
      setIsPreparingManagementSecurity(false);
    }
  };

  const applyManagementSecurity = async () => {
    const workflow = managementSecurityWorkflowRef.current;
    setManagementSecurityConfirmationOpen(false);
    if (!workflow) {
      setFeedback({
        kind: "error",
        text: "Le contrôle du compte dédié n'est plus valide. Relancez sa préparation."
      });
      return;
    }

    setIsApplyingManagementSecurity(true);
    setFeedback(null);
    try {
      const result = await workflow.apply();
      let manifestSaved = true;
      try {
        const existingManifest = await managedResourceManifestRepository.findByRouter(router!.id);
        await managedResourceManifestRepository.save(
          session!.account_id,
          router!.id,
          mergeRouterManagementSecurityManifest(
            existingManifest?.manifest ?? null,
            result.manifest
          )
        );
      } catch {
        manifestSaved = false;
      }
      managementSecurityWorkflowRef.current = null;
      setManagementSecurity(result);
      setManagementSecurityApplied(true);
      setManagementSecurityAudit("secured");
      setManagementSecurityObservedAt(new Date().toISOString());
      setTestMessage("Routeur connecté");
      setFeedback({
        kind: "success",
        text: `Administration RouterOS sécurisée. ${result.policy.disabledServices.length} service(s) inutilisé(s) désactivé(s) et ${result.policy.restrictedServices.length} service(s) limité(s) au LAN/VPN.${manifestSaved ? "" : " Le diagnostic local sera recapturé à la prochaine réconciliation."}`
      });
    } catch (error) {
      setManagementSecurityApplied(false);
      setManagementSecurityAudit("drift");
      setManagementSecurityObservedAt(new Date().toISOString());
      setFeedback({
        kind: "error",
        text: `La vérification finale a échoué. Le compte admin n'a pas été désactivé. ${accessActionError(error, "Contrôlez l'accès RouterOS.")}`
      });
    } finally {
      setIsApplyingManagementSecurity(false);
    }
  };

  const removeInfrastructureDevice = async (device: InfrastructureDevice) => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut retirer cet équipement." });
      return;
    }

    const candidate: RouterAccessPolicy = {
      ...accessPolicy,
      infrastructureDevices: accessPolicy.infrastructureDevices.filter(
        (item) => item.id !== device.id
      )
    };
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    let missingOnRouter = false;

    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      if (device.internetBypass) {
        const result = await service.removeHotspotBypass(device.id, device.macAddress);
        if (result.outcome === "not_found") {
          missingOnRouter = true;
        }
      }

      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        candidate,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setFeedback(missingOnRouter
        ? {
            kind: "error",
            text: `${device.name} était introuvable sur le MikroTik. Sa référence locale et VPS a été nettoyée.`
          }
        : syncResult.status === "synced"
        ? {
            kind: "success",
            text: `${device.name} a été retiré de RouterOS, de la base locale et du VPS.`
          }
        : syncResult.status === "conflict"
          ? {
              kind: "error",
              text: `${device.name} a été retiré de RouterOS et localement, mais un conflit VPS doit être résolu.`
            }
          : {
              kind: "success",
              text: `${device.name} a été retiré de RouterOS et localement. Le VPS sera synchronisé au retour du réseau.`
            });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: accessActionError(error, `Impossible de retirer ${device.name} du MikroTik.`)
      });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const updateBlockedDeviceDraft = (partial: Partial<Omit<BlockedDevice, "id">>) => {
    setBlockedDeviceDraft((current) => ({ ...current, ...partial }));
    setBlockedDeviceDraftError(null);
    setFeedback(null);
  };

  const addBlockedDevice = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut bloquer un appareil." });
      return;
    }
    const device: BlockedDevice = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ipAddress: blockedDeviceDraft.ipAddress.trim(),
      macAddress: normalizeMacAddress(blockedDeviceDraft.macAddress),
      name: blockedDeviceDraft.name.trim()
    };
    const duplicate = accessPolicy.blockedDevices.find((item) =>
      (device.ipAddress && item.ipAddress === device.ipAddress)
      || (device.macAddress && normalizeMacAddress(item.macAddress) === device.macAddress)
    );
    if (duplicate) {
      const message = `Équipement déjà présent dans les blocages : ${duplicate.name}.`;
      setBlockedDeviceDraftError(message);
      setFeedback({ kind: "error", text: message });
      return;
    }
    const candidate: RouterAccessPolicy = {
      ...accessPolicy,
      blockedDevices: [...accessPolicy.blockedDevices, device]
    };
    const validationError = validateRouterAccessPolicy(candidate);
    if (validationError) {
      setBlockedDeviceDraftError(validationError);
      setFeedback({ kind: "error", text: validationError });
      return;
    }

    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      const result = await service.upsertHotspotBlockedDevice({
        address: device.ipAddress,
        comment: device.name,
        id: device.id,
        macAddress: device.macAddress
      });
      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        candidate,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setBlockedDeviceDraft(emptyBlockedDevice);
      setBlockedDeviceDraftError(null);
      setFeedback({
        kind: syncResult.status === "conflict" ? "error" : "success",
        text: syncResult.status === "conflict"
          ? `${device.name} est bloqué sur RouterOS et localement, mais un conflit VPS doit être résolu.`
          : syncResult.status !== "synced"
            ? `${device.name} est bloqué sur RouterOS et localement. Le VPS sera synchronisé au retour du réseau.`
            : result.outcome === "already_present"
              ? `${device.name} était déjà bloqué sur le MikroTik. La configuration locale et VPS a été resynchronisée.`
              : result.outcome === "updated"
                ? `Le blocage de ${device.name} a été mis à jour sur RouterOS, localement et sur le VPS.`
                : `${device.name} a été bloqué sur RouterOS, localement et sur le VPS.`
      });
    } catch (error) {
      setFeedback({ kind: "error", text: accessActionError(error, `Impossible de bloquer ${device.name}.`) });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const removeBlockedDevice = async (device: BlockedDevice) => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut débloquer un appareil." });
      return;
    }
    const candidate: RouterAccessPolicy = {
      ...accessPolicy,
      blockedDevices: accessPolicy.blockedDevices.filter((item) => item.id !== device.id)
    };
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({
        authSession: session,
        connections,
        database,
        router
      });
      const result = await service.removeHotspotBlockedDevice(device.id, device.macAddress);
      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        candidate,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setFeedback(result.outcome === "not_found"
        ? {
            kind: "error",
            text: `${device.name} était introuvable sur le MikroTik. Sa référence locale et VPS a été nettoyée.`
          }
        : syncResult.status === "conflict"
          ? {
              kind: "error",
              text: `${device.name} est débloqué sur RouterOS et localement, mais un conflit VPS doit être résolu.`
            }
          : syncResult.status !== "synced"
            ? {
                kind: "success",
                text: `${device.name} est débloqué sur RouterOS et localement. Le VPS sera synchronisé au retour du réseau.`
              }
            : {
                kind: "success",
                text: `${device.name} a été débloqué sur RouterOS, localement et sur le VPS.`
              });
    } catch (error) {
      setFeedback({ kind: "error", text: accessActionError(error, `Impossible de débloquer ${device.name}.`) });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const applyInfrastructurePolicy = async (
    _previousPolicy: RouterAccessPolicy,
    nextPolicy: RouterAccessPolicy
  ) => {
    if (!router || !session) throw new Error("Routeur ou session introuvable.");
    const connections = await connectionRepository.listByRouter(router.id);
    const service = await createPersistedRouterService({
      authSession: session,
      connections,
      database,
      router
    });
    const desired = nextPolicy.infrastructureDevices.filter((device) => device.internetBypass);
    const desiredIds = new Set(desired.map((device) => device.id));
    for (const binding of await service.listManagedHotspotBypasses()) {
      if (!desiredIds.has(binding.id)) {
        await service.removeHotspotBypass(binding.id, binding.macAddress);
      }
    }
    for (const device of desired) {
      await service.upsertHotspotBypass({
        address: device.ipAddress,
        comment: `${device.name} (${device.type})`,
        id: device.id,
        macAddress: device.macAddress
      });
    }
    const verified = await service.listManagedHotspotBypasses();
    if (
      verified.length !== desired.length
      || desired.some((device) => !verified.some((binding) =>
        binding.id === device.id
        && binding.address === device.ipAddress
        && normalizeMacAddress(binding.macAddress) === normalizeMacAddress(device.macAddress)
      ))
    ) {
      throw new Error("RouterOS n'a pas confirmé la synchronisation complète des bypass IP Binding.");
    }
  };

  const applyBlockedDevicesPolicy = async (policy: RouterAccessPolicy) => {
    if (!router || !session) throw new Error("Routeur ou session introuvable.");
    const connections = await connectionRepository.listByRouter(router.id);
    const service = await createPersistedRouterService({ authSession: session, connections, database, router });
    const desiredIds = new Set(policy.blockedDevices.map((device) => device.id));
    for (const binding of await service.listManagedHotspotBlockedDevices()) {
      if (!desiredIds.has(binding.id)) {
        await service.removeHotspotBlockedDevice(binding.id, binding.macAddress);
      }
    }
    for (const device of policy.blockedDevices) {
      await service.upsertHotspotBlockedDevice({
        address: device.ipAddress,
        comment: device.name,
        id: device.id,
        macAddress: device.macAddress
      });
    }
    const verified = await service.listManagedHotspotBlockedDevices();
    if (
      verified.length !== policy.blockedDevices.length
      || policy.blockedDevices.some((device) => !verified.some((binding) =>
        binding.id === device.id
        && binding.address === device.ipAddress
        && normalizeMacAddress(binding.macAddress) === normalizeMacAddress(device.macAddress)
      ))
    ) {
      throw new Error("RouterOS n'a pas confirmé la synchronisation complète des appareils bloqués.");
    }
  };

  const applyAntiSharingPolicy = async (policy: RouterAccessPolicy) => {
    if (!router || !session) throw new Error("Routeur ou session introuvable.");
    const connections = await connectionRepository.listByRouter(router.id);
    const service = await createPersistedRouterService({
      authSession: session,
      connections,
      database,
      router
    });
    await service.configureHotspotAntiTethering({
      blockIpv4Ttl: policy.monitorIpv4Ttl,
      blockIpv6: policy.monitorIpv6HopLimit,
      enabled: policy.antiSharingMode === "strict"
    });
    const verified = await service.getHotspotAntiTetheringState();
    const expectedIpv4 = policy.antiSharingMode === "strict" && policy.monitorIpv4Ttl;
    const expectedIpv6 = policy.antiSharingMode === "strict" && policy.monitorIpv6HopLimit;
    if (verified.blockIpv4Ttl !== expectedIpv4 || verified.blockIpv6 !== expectedIpv6) {
      throw new Error("RouterOS n'a pas confirmé l'état réel des protections anti-partage.");
    }
    // Every enabled Hotspot interface must be covered, not just one.
    const issues = antiTetheringCoverageIssues(policy, verified);
    setAntiTetheringCheck({ issues, summary: antiTetheringCoverageSummary(verified) });
    if (issues.length > 0) {
      throw new Error(`RouterOS n'applique pas la protection partout : ${issues.join(" ")}`);
    }
  };

  // Check what the router really enforces each time the page opens: a new
  // Hotspot network or a rule disabled in Winbox is reported, not hidden.
  const routerIdForAntiTethering = router?.id ?? null;
  const savedAntiSharingKey = `${savedAccessPolicy.antiSharingMode}:${savedAccessPolicy.monitorIpv4Ttl}:${savedAccessPolicy.monitorIpv6HopLimit}`;
  useEffect(() => {
    if (!router || !session || savedAccessPolicy.antiSharingMode !== "strict") {
      setAntiTetheringCheck(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const service = await createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(router.id),
        database,
        logActions: false,
        router
      });
      const state = await service.getHotspotAntiTetheringState();
      if (!cancelled) {
        setAntiTetheringCheck({
          issues: antiTetheringCoverageIssues(savedAccessPolicy, state),
          summary: antiTetheringCoverageSummary(state)
        });
      }
    })().catch(() => {
      if (!cancelled) setAntiTetheringCheck(null);
    });
    return () => {
      cancelled = true;
    };
    // The policy fields are summarized by savedAntiSharingKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerIdForAntiTethering, savedAntiSharingKey, session?.account_id]);

  const reapplyAntiSharingPolicy = async () => {
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      await applyAntiSharingPolicy(savedAccessPolicy);
      setFeedback({ kind: "success", text: "Protection anti-partage réappliquée et vérifiée sur tous les réseaux hotspot." });
    } catch (error) {
      setFeedback({ kind: "error", text: accessActionError(error, "Impossible de réappliquer la protection anti-partage.") });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const refreshAccessPolicyFromRouter = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Le routeur n'est pas encore disponible." });
      return;
    }
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      const connections = await connectionRepository.listByRouter(router.id);
      const service = await createPersistedRouterService({ authSession: session, connections, database, router });
      const [ttlState, routerBypasses, routerBlockedDevices] = await Promise.all([
        service.getHotspotAntiTetheringState(),
        service.listManagedHotspotBypasses(),
        service.listManagedHotspotBlockedDevices()
      ]);
      const localInfrastructureById = new Map(
        accessPolicy.infrastructureDevices.map((device) => [device.id, device])
      );
      const localBlockedById = new Map(accessPolicy.blockedDevices.map((device) => [device.id, device]));
      const nextPolicy: RouterAccessPolicy = {
        ...accessPolicy,
        antiSharingMode: ttlState.blockIpv4Ttl || ttlState.blockIpv6
          ? "strict"
          : accessPolicy.antiSharingMode === "observe" ? "observe" : "disabled",
        blockedDevices: routerBlockedDevices.map((binding) => ({
          id: binding.id,
          ipAddress: binding.address,
          macAddress: binding.macAddress,
          name: localBlockedById.get(binding.id)?.name || binding.comment || "Appareil bloqué"
        })),
        infrastructureDevices: [
          ...accessPolicy.infrastructureDevices.filter((device) => !device.internetBypass),
          ...routerBypasses.map((binding) => {
            const existing = localInfrastructureById.get(binding.id);
            return existing
              ? { ...existing, internetBypass: true, ipAddress: binding.address, macAddress: binding.macAddress }
              : {
                  id: binding.id,
                  internetBypass: true,
                  ipAddress: binding.address,
                  macAddress: binding.macAddress,
                  mode: "bridge" as const,
                  name: binding.comment || "Équipement RouterOS",
                  type: "other" as const
                };
          })
        ],
        monitorIpv4Ttl: ttlState.blockIpv4Ttl,
        monitorIpv6HopLimit: ttlState.blockIpv6
      };
      const validationError = validateRouterAccessPolicy(nextPolicy);
      if (validationError) throw new Error(validationError);
      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        nextPolicy,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setFeedback({
        kind: syncResult.status === "conflict" ? "error" : "success",
        text: syncResult.status === "conflict"
          ? "État RouterOS récupéré, mais un conflit avec le VPS doit être résolu."
          : "État réel des protections et IP Binding récupéré depuis le MikroTik."
      });
    } catch (error) {
      setFeedback({ kind: "error", text: accessActionError(error, "Impossible de lire les IP Binding du routeur.") });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const saveAccessPolicy = async () => {
    if (!canEditSensitive || !router || !session) {
      setFeedback({ kind: "error", text: "Seul l'Admin peut modifier cette politique réseau." });
      return;
    }

    if (hasInfrastructureDraftContent(infrastructureDraft)) {
      const message =
        "L’équipement renseigné n’est pas encore dans la liste. Corrigez les champs puis cliquez sur « Ajouter à la liste » avant d’enregistrer.";
      setInfrastructureDraftError(message);
      setFeedback({ kind: "error", text: message });
      return;
    }

    if (hasBlockedDeviceDraftContent(blockedDeviceDraft)) {
      const message =
        "L’appareil renseigné n’est pas encore bloqué. Corrigez les champs puis cliquez sur « Bloquer l’appareil » avant d’enregistrer.";
      setBlockedDeviceDraftError(message);
      setFeedback({ kind: "error", text: message });
      return;
    }

    const validationError = validateRouterAccessPolicy(accessPolicy);
    if (validationError) {
      setFeedback({ kind: "error", text: validationError });
      return;
    }
    if (hasUnsavedConnectionChanges(router, settings)) {
      setFeedback({
        kind: "error",
        text: "Enregistrez d'abord les paramètres de connexion avant d'appliquer la politique réseau."
      });
      return;
    }

    setIsSavingAccessPolicy(true);
    setFeedback(null);

    try {
      await applyAntiSharingPolicy(accessPolicy);
      await applyInfrastructurePolicy(savedAccessPolicy, accessPolicy);
      await applyBlockedDevicesPolicy(accessPolicy);

      const syncResult = await accessPolicySyncService.saveAndSync(
        session.account_id,
        router.id,
        accessPolicy,
        cloudRouterId
      );
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(
        syncResult.status === "conflict" && syncResult.remotePolicy
          ? { policy: syncResult.remotePolicy, revision: syncResult.revision }
          : null
      );
      setFeedback(syncResult.status === "synced"
        ? {
            kind: "success",
            text: "Politique synchronisée avec RouterOS, la base locale et le VPS."
          }
        : syncResult.status === "conflict"
          ? {
              kind: "error",
              text: "Conflit détecté avec un autre PC. Aucune configuration distante n'a été écrasée."
            }
          : {
              kind: "success",
              text: "RouterOS et la base locale sont à jour. La synchronisation VPS reprendra automatiquement dès le retour du réseau."
            });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: accessActionError(error, "Impossible d'appliquer la politique d'accès.")
      });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  const resolveAccessPolicyConflict = async (choice: "local" | "remote") => {
    if (!conflictingRemotePolicy || !router || !session) return;
    setIsSavingAccessPolicy(true);
    setFeedback(null);
    try {
      const syncResult = choice === "remote"
          ? await (async () => {
            await applyAntiSharingPolicy(conflictingRemotePolicy.policy);
            await applyInfrastructurePolicy(
              savedAccessPolicy,
              conflictingRemotePolicy.policy
            );
            await applyBlockedDevicesPolicy(conflictingRemotePolicy.policy);
            return accessPolicySyncService.acceptRemote(
              session.account_id,
              router.id,
              conflictingRemotePolicy.policy,
              conflictingRemotePolicy.revision,
              cloudRouterId
            );
          })()
        : await (async () => {
            await applyAntiSharingPolicy(accessPolicy);
            await applyInfrastructurePolicy(savedAccessPolicy, accessPolicy);
            await applyBlockedDevicesPolicy(accessPolicy);
            return accessPolicySyncService.overwriteRemote(
              session.account_id,
              router.id,
              accessPolicy,
              conflictingRemotePolicy.revision,
              cloudRouterId
            );
          })();
      setAccessPolicy(syncResult.policy);
      setSavedAccessPolicy(structuredClone(syncResult.policy));
      setAccessPolicySyncStatus(syncResult.status);
      setConflictingRemotePolicy(null);
      setFeedback({
        kind: "success",
        text: choice === "remote"
          ? "La version du VPS a été appliquée localement et sur RouterOS."
          : "La version de ce PC a remplacé la version du VPS."
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error
          ? error.message
          : "Impossible de résoudre le conflit de synchronisation."
      });
    } finally {
      setIsSavingAccessPolicy(false);
    }
  };

  if (!canView) {
    return (
      <div className="page-stack">
        <PageHeader description="Accès réservé aux profils autorisés." eyebrow="Routeur" title="Paramètres routeur" />
        <Card>
          <StatusDot label="Accès non autorisé" status="error" />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        actions={canEditSensitive ? (
          <Button disabled={isLoading || isSaving || !router} icon={Save} onClick={() => void saveSettings()} variant="primary">
            {isSaving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        ) : null}
        description="Configuration réelle du routeur et de son portail captif."
        eyebrow="Routeur"
        title="Paramètres routeur"
      />

      {feedback ? (
        <p className={`form-error${feedback.kind === "success" ? " form-error--success" : ""}`}>
          {feedback.text}
        </p>
      ) : null}

      <Card title="Connexion routeur" description="Ces informations sont enregistrées pour ce routeur et utilisées par RouterOS.">
        <div className="router-form-grid">
          <label className="form-field">
            Nom du routeur
            <input disabled={!canEditSensitive || isLoading} value={settings.name} onChange={(event) => updateSettings({ name: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse IP locale
            <input disabled={!canEditSensitive || isLoading} value={settings.ipAddress} onChange={(event) => updateSettings({ ipAddress: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse Hotspot / portail captif
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="Ex. wifi.mon-etablissement.com"
              value={settings.hotspotAddress}
              onChange={(event) => updateSettings({ hotspotAddress: event.target.value })}
            />
            <small>Adresse que les clients saisiront dans leur navigateur. Elle figurera sur chaque ticket.</small>
          </label>
          <label className="form-field">
            Port API
            <input disabled={!canEditSensitive || isLoading} value={settings.apiPort} onChange={(event) => updateSettings({ apiPort: event.target.value })} />
          </label>
          <label className="form-field">
            Port API SSL
            <input disabled={!canEditSensitive || isLoading} value={settings.apiSslPort} onChange={(event) => updateSettings({ apiSslPort: event.target.value })} />
          </label>
          <label className="form-field">
            Mode de connexion prioritaire
            <select
              disabled={!canEditSensitive || isLoading}
              value={settings.connectionMode}
              onChange={(event) => updateSettings({ connectionMode: event.target.value as RouterSettings["connectionMode"] })}
            >
              <option value="local">Local</option>
              <option value="distant_ip">Adresse distante</option>
              <option value="vpn">VPN</option>
              <option value="agent_future">Agent distant futur</option>
            </select>
          </label>
          <label className="form-field">
            Utilisateur MikroTik
            <input disabled={!canEditSensitive || isLoading} value={settings.username} onChange={(event) => updateSettings({ username: event.target.value })} />
          </label>
          <PasswordField
            autoComplete="new-password"
            disabled={!canEditSensitive || isLoading}
            label="Nouveau mot de passe MikroTik"
            onChange={(password) => updateSettings({ password })}
            placeholder="Laisser vide pour conserver le mot de passe actuel"
            value={settings.password}
          />
        </div>
        <div className="router-form-result">
          <Badge status={testMessage === "Routeur connecté" ? "success" : testMessage === "Connexion échouée" ? "error" : "warning"}>
            {testMessage}
          </Badge>
          <Button disabled={!canEditSensitive || isLoading || isTesting || !router} icon={Search} onClick={() => void testConnection()}>
            {isTesting ? "Test en cours…" : "Tester la connexion réelle"}
          </Button>
        </div>
      </Card>

      <Card
        className={shouldFocusAntiSharing ? "router-settings-focus" : ""}
        id="controle-acces-anti-partage"
        tabIndex={-1}
        title="Contrôle d'accès et anti-partage"
        description="Choisissez séparément le blocage du partage réseau et le verrouillage facultatif des vouchers par appareil."
      >
        <div className="anti-sharing-config">
          <label className="form-field anti-sharing-mode">
            Contrôle du partage de connexion
            <select
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => {
                const antiSharingMode =
                  event.target.value as RouterAccessPolicy["antiSharingMode"];
                updateAccessPolicy(antiSharingMode === "strict"
                  ? { antiSharingMode }
                  : {
                      antiSharingMode,
                      monitorIpv4Ttl: false,
                      monitorIpv6HopLimit: false
                    });
              }}
              value={accessPolicy.antiSharingMode}
            >
              <option value="disabled">Désactivé — aucune règle réseau</option>
              <option value="observe">Observation — aucune règle TTL/IPv6</option>
              <option value="strict">Strict — appliquer les protections choisies</option>
            </select>
            <small>
              Désactivé ne configure rien. Observation n’installe aucune règle réseau.
              Strict applique uniquement les protections réseau cochées ci-dessous.
            </small>
          </label>
          {antiTetheringCheck?.issues.length ? (
            <div className="notice notice--error" role="alert">
              <strong>Protection incomplète sur le routeur.</strong>
              <ul>{antiTetheringCheck.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              {canEditSensitive ? (
                <Button disabled={isSavingAccessPolicy} onClick={() => void reapplyAntiSharingPolicy()} variant="primary">
                  Réappliquer la protection
                </Button>
              ) : null}
            </div>
          ) : antiTetheringCheck?.summary ? (
            <p className="notice notice--success">{antiTetheringCheck.summary} (vérifié sur RouterOS).</p>
          ) : null}

          <div className="anti-sharing-option-grid">
            <label className={`anti-sharing-option-card${accessPolicy.lockVoucherToFirstMac ? " is-checked" : ""}`}>
              <input
                checked={accessPolicy.lockVoucherToFirstMac}
                disabled={!canEditSensitive || isLoading}
                onChange={(event) => updateAccessPolicy({
                  lockVoucherToFirstMac: event.target.checked
                })}
                type="checkbox"
              />
              <span className="anti-sharing-option-card__icon">
                <ShieldCheck aria-hidden="true" />
              </span>
              <span className="anti-sharing-option-card__content">
                <strong>Verrouillage du voucher par MAC</strong>
                <small>
                  La première adresse MAC qui utilise le voucher devient la seule autorisée.
                  Un changement d’appareil exige de libérer cette liaison dans TicketPro.
                </small>
                <em>Indépendant du mode réseau</em>
              </span>
            </label>

            <label
              className={[
                "anti-sharing-option-card",
                accessPolicy.monitorIpv4Ttl ? "is-checked" : "",
                accessPolicy.antiSharingMode !== "strict" ? "is-disabled" : ""
              ].filter(Boolean).join(" ")}
            >
              <input
                checked={accessPolicy.monitorIpv4Ttl}
                disabled={!canEditSensitive || isLoading || accessPolicy.antiSharingMode !== "strict"}
                onChange={(event) => updateAccessPolicy({
                  monitorIpv4Ttl: event.target.checked
                })}
                type="checkbox"
              />
              <span className="anti-sharing-option-card__icon">
                <Network aria-hidden="true" />
              </span>
              <span className="anti-sharing-option-card__content">
                <strong>Empêcher le partage de connexion IPv4</strong>
                <small>
                  Le téléphone qui a validé le voucher garde Internet. MikroTik limite les
                  réponses à ce téléphone afin qu’elles ne puissent pas être retransmises aux
                  appareils connectés à son point d’accès.
                </small>
                <em>{accessPolicy.antiSharingMode === "strict" ? "Protection disponible" : "Nécessite le mode strict"}</em>
              </span>
            </label>

            <label
              className={[
                "anti-sharing-option-card",
                accessPolicy.monitorIpv6HopLimit ? "is-checked" : "",
                accessPolicy.antiSharingMode !== "strict" ? "is-disabled" : ""
              ].filter(Boolean).join(" ")}
            >
              <input
                checked={accessPolicy.monitorIpv6HopLimit}
                disabled={!canEditSensitive || isLoading || accessPolicy.antiSharingMode !== "strict"}
                onChange={(event) => updateAccessPolicy({
                  monitorIpv6HopLimit: event.target.checked
                })}
                type="checkbox"
              />
              <span className="anti-sharing-option-card__icon">
                <Network aria-hidden="true" />
              </span>
              <span className="anti-sharing-option-card__content">
                <strong>Empêcher le contournement par IPv6</strong>
                <small>
                  À activer seulement si le Hotspot distribue de l’IPv6. RouterOS bloque alors
                  l’IPv6 sur ce réseau, car l’authentification Hotspot et la protection TTL sont
                  appliquées en IPv4.
                </small>
                <em>{accessPolicy.antiSharingMode === "strict" ? "Protection disponible" : "Nécessite le mode strict"}</em>
              </span>
            </label>
          </div>

          <div className="router-form-result anti-sharing-apply">
            <span>Les choix ne prennent effet sur le MikroTik qu’après validation.</span>
            <Button
              disabled={!canEditSensitive || isLoading || isSavingAccessPolicy || !router}
              icon={Save}
              onClick={() => void saveAccessPolicy()}
              variant="primary"
            >
              {isSavingAccessPolicy ? "Application…" : "Enregistrer et appliquer"}
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title="Antennes et équipements d'infrastructure"
        description="Seuls les équipements en bridge transparent peuvent être bypassés. Leurs clients restent soumis au portail captif."
      >
        <div className="router-form-result">
          <StatusDot
            label={accessPolicySyncLabel(accessPolicySyncStatus)}
            status={
              accessPolicySyncStatus === "synced"
                ? "active"
                : accessPolicySyncStatus === "conflict"
                  ? "error"
                  : "warning"
            }
          />
          <span>La configuration locale reste utilisable même pendant une coupure Internet.</span>
          <Button
            disabled={!canEditSensitive || isLoading || isSavingAccessPolicy || !router}
            icon={Search}
            onClick={() => void refreshAccessPolicyFromRouter()}
          >
            {isSavingAccessPolicy ? "Lecture…" : "Relire le MikroTik"}
          </Button>
        </div>

        {conflictingRemotePolicy ? (
          <div className="router-form-result">
            <span>
              Une autre installation a modifié cette politique. Choisissez explicitement la version à conserver.
            </span>
            <div className="button-row">
              <Button
                disabled={isSavingAccessPolicy}
                onClick={() => void resolveAccessPolicyConflict("remote")}
              >
                Utiliser la version VPS
              </Button>
              <Button
                disabled={isSavingAccessPolicy}
                onClick={() => void resolveAccessPolicyConflict("local")}
                variant="primary"
              >
                Conserver cette version
              </Button>
            </div>
          </div>
        ) : null}

        <div className="router-form-grid">
          <label className="form-field">
            Nom de l'équipement
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="Ex. Antenne toit nord"
              value={infrastructureDraft.name}
              onChange={(event) => updateInfrastructureDraft({ name: event.target.value })}
            />
          </label>
          <label className="form-field">
            Type
            <select
              disabled={!canEditSensitive || isLoading}
              value={infrastructureDraft.type}
              onChange={(event) => updateInfrastructureDraft({
                type: event.target.value as InfrastructureDevice["type"]
              })}
            >
              <option value="antenna">Antenne</option>
              <option value="access_point">Point d'accès</option>
              <option value="repeater">Répéteur</option>
              <option value="other">Autre</option>
            </select>
          </label>
          <div className="infrastructure-bridge-note" role="note">
            <span className="infrastructure-bridge-note__icon">
              <ShieldCheck aria-hidden="true" />
            </span>
            <span>
              <strong>Bridge transparent obligatoire</strong>
              <small>
                TicketPro enregistrera automatiquement ce mode. Un équipement en
                routeur/NAT ne peut pas être bypassé, car il masque les appareils
                placés derrière lui.
              </small>
            </span>
          </div>
          <label className="form-field">
            Adresse MAC
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="AA:BB:CC:DD:EE:FF"
              value={infrastructureDraft.macAddress}
              onChange={(event) => updateInfrastructureDraft({ macAddress: event.target.value })}
            />
          </label>
          <label className="form-field">
            Adresse IP fixe ou réservée
            <input
              disabled={!canEditSensitive || isLoading}
              placeholder="192.168.88.10"
              value={infrastructureDraft.ipAddress}
              onChange={(event) => updateInfrastructureDraft({ ipAddress: event.target.value })}
            />
            <small>L'adresse doit rester stable sur le MikroTik.</small>
          </label>
          <label className="toggle-option">
            <input
              checked={infrastructureDraft.internetBypass}
              disabled={!canEditSensitive || isLoading}
              onChange={(event) => updateInfrastructureDraft({
                internetBypass: event.target.checked
              })}
              type="checkbox"
            />
            <RadioTower aria-hidden="true" />
            <span>Autoriser Internet pour l'équipement</span>
          </label>
        </div>
        {infrastructureDraftError ? (
          <p className="form-error">{infrastructureDraftError}</p>
        ) : null}
        <div className="router-form-result">
          <span>
            Le bypass concerne uniquement l'adresse de gestion de l'antenne, jamais les clients situés derrière.
          </span>
          <Button
            disabled={!canEditSensitive || isLoading || isSavingAccessPolicy}
            icon={Plus}
            onClick={() => void addInfrastructureDevice()}
          >
            {isSavingAccessPolicy ? "Ajout…" : "Ajouter le bypass"}
          </Button>
        </div>

        {isLoading ? (
          <StatusDot label="Chargement des équipements enregistrés…" status="warning" />
        ) : accessPolicy.infrastructureDevices.length > 0 ? (
          <div className="data-list">
            {accessPolicy.infrastructureDevices.map((device) => (
              <DataListItem
                description={`${device.ipAddress} · ${device.macAddress} · ${
                  device.mode === "bridge" ? "Bridge transparent" : "Non bridge"
                }`}
                icon={RadioTower}
                key={device.id}
                meta={(
                  <Button
                    disabled={!canEditSensitive || isSavingAccessPolicy}
                    icon={Trash2}
                    onClick={() => void removeInfrastructureDevice(device)}
                    variant="ghost"
                  >
                    Retirer du MikroTik
                  </Button>
                )}
                title={`${device.name}${device.internetBypass ? " · bypass Internet" : ""}`}
              />
            ))}
          </div>
        ) : (
          <StatusDot label="Aucun équipement d'infrastructure déclaré." status="warning" />
        )}

        <div className="router-form-result">
          <span>Seuls les équipements affichés dans la liste seront synchronisés.</span>
          <Button
            disabled={!canEditSensitive || isLoading || isSavingAccessPolicy || !router}
            icon={Save}
            onClick={() => void saveAccessPolicy()}
            variant="primary"
          >
            {isSavingAccessPolicy ? "Synchronisation…" : "Enregistrer et appliquer"}
          </Button>
        </div>
      </Card>

      {canEditSensitive ? (
        <Card
          title="Sécurité de l'administration RouterOS"
          description="Créez un compte TicketPro à permissions limitées, vérifiez-le, puis restreignez les services au LAN et au VPN."
        >
          <div className="data-list">
            <DataListItem
              description="Le compte admin existant reste disponible et n'est jamais supprimé ni désactivé par cette procédure."
              icon={ShieldCheck}
              meta={(
                <Badge status={
                  managementSecurityApplied || managementSecurityAudit === "secured"
                    ? "success"
                    : managementSecurityAudit === "drift"
                      ? "error"
                      : managementSecurity
                        ? "warning"
                        : "offline"
                }>
                  {managementSecurityApplied
                    ? "Sécurisé · vérifié maintenant"
                    : managementSecurityAudit === "secured"
                      ? "Conforme au dernier audit"
                    : managementSecurityAudit === "drift"
                      ? "Dérive détectée"
                    : managementSecurity
                      ? "Compte vérifié"
                      : "Audit à relire"}
                </Badge>
              )}
              title="Compte dédié ticketpro-api"
            />
            <DataListItem
              description={managementSecurity
                ? managementSecurity.authorizedCidrs.join(" · ")
                : "LAN du routeur · VPN TicketPro 10.250.0.0/16"}
              icon={Network}
              title="Réseaux d'administration autorisés"
            />
            <DataListItem
              description={managementSecurityObservedAt
                ? `Dernière observation : ${new Date(managementSecurityObservedAt).toLocaleString("fr-FR")}`
                : "Aucune observation locale enregistrée. La préparation effectuera un test réel."}
              icon={Search}
              title="Fraîcheur du contrôle"
            />
          </div>
          <div className="router-form-result">
            <span>
              Étape 1 : créer et tester le compte. Étape 2 : appliquer les restrictions après confirmation.
            </span>
            <Button
              disabled={
                isLoading
                || isPreparingManagementSecurity
                || isApplyingManagementSecurity
                || !router
              }
              icon={ShieldCheck}
              onClick={() => void prepareManagementSecurity()}
            >
              {isPreparingManagementSecurity
                ? "Préparation et test…"
                : managementSecurity
                  ? "Retester le compte dédié"
                  : managementSecurityApplied || managementSecurityAudit === "secured"
                    ? "Revérifier le compte dédié"
                    : "Préparer le compte dédié"}
            </Button>
          </div>
          {managementSecurity && !managementSecurityApplied ? (
            <div className="router-form-result">
              <span>
                Compte testé via {managementSecurity.connectionMode}. FTP, Telnet, WebFig HTTP/HTTPS et API-SSL non configurée seront désactivés ; API, WinBox et SSH seront limités aux réseaux affichés.
              </span>
              <Button
                disabled={isApplyingManagementSecurity}
                icon={ShieldCheck}
                onClick={() => setManagementSecurityConfirmationOpen(true)}
                variant="primary"
              >
                {isApplyingManagementSecurity ? "Sécurisation…" : "Appliquer les restrictions"}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="IP Binding — appareils bloqués"
        description="Bloquez une adresse IP, une adresse MAC, ou les deux. TicketPro ne modifie que les bindings qu'il gère."
      >
        <div className="router-form-grid">
          <label className="form-field">
            Nom de l'appareil
            <input
              disabled={!canEditSensitive || isLoading || isSavingAccessPolicy}
              placeholder="Ex. Téléphone indésirable"
              value={blockedDeviceDraft.name}
              onChange={(event) => updateBlockedDeviceDraft({ name: event.target.value })}
            />
          </label>
          <label className="form-field">
            Adresse IP
            <input
              disabled={!canEditSensitive || isLoading || isSavingAccessPolicy}
              placeholder="192.168.88.120"
              value={blockedDeviceDraft.ipAddress}
              onChange={(event) => updateBlockedDeviceDraft({ ipAddress: event.target.value })}
            />
          </label>
          <label className="form-field">
            Adresse MAC
            <input
              disabled={!canEditSensitive || isLoading || isSavingAccessPolicy}
              placeholder="AA:BB:CC:DD:EE:FF"
              value={blockedDeviceDraft.macAddress}
              onChange={(event) => updateBlockedDeviceDraft({ macAddress: event.target.value })}
            />
            <small>Une adresse IP ou MAC au minimum est obligatoire.</small>
          </label>
        </div>
        {blockedDeviceDraftError ? <p className="form-error">{blockedDeviceDraftError}</p> : null}
        <div className="router-form-result">
          <span>Le blocage utilise un IP Binding RouterOS de type « blocked ».</span>
          <Button
            disabled={!canEditSensitive || isLoading || isSavingAccessPolicy || !router}
            icon={Ban}
            onClick={() => void addBlockedDevice()}
            variant="danger"
          >
            {isSavingAccessPolicy ? "Application…" : "Bloquer l'appareil"}
          </Button>
        </div>

        {accessPolicy.blockedDevices.length > 0 ? (
          <div className="data-list">
            {accessPolicy.blockedDevices.map((device) => (
              <DataListItem
                description={[
                  device.ipAddress ? `IP ${device.ipAddress}` : null,
                  device.macAddress ? `MAC ${device.macAddress}` : null
                ].filter(Boolean).join(" · ")}
                icon={Ban}
                key={device.id}
                meta={(
                  <Button
                    disabled={!canEditSensitive || isSavingAccessPolicy}
                    onClick={() => void removeBlockedDevice(device)}
                    variant="ghost"
                  >
                    Débloquer
                  </Button>
                )}
                title={device.name}
              />
            ))}
          </div>
        ) : (
          <StatusDot label="Aucun appareil bloqué par TicketPro." status="offline" />
        )}
      </Card>

      {!isPersistent ? (
        <Card>
          <StatusDot label="La persistance native est indisponible dans ce mode." status="warning" />
        </Card>
      ) : null}

      <ConfirmDialog
        confirmLabel="Appliquer maintenant"
        description="TicketPro va limiter les services d'administration au LAN du routeur et au VPN 10.250.0.0/16. Le compte admin existant restera actif. N'appliquez cette étape que si l'accès local ou VPN testé est votre chemin de secours."
        isOpen={managementSecurityConfirmationOpen}
        onCancel={() => setManagementSecurityConfirmationOpen(false)}
        onConfirm={() => void applyManagementSecurity()}
        title="Restreindre les services RouterOS ?"
      />
    </div>
  );
}

function hasInfrastructureDraftContent(
  draft: Omit<InfrastructureDevice, "id">
): boolean {
  return Boolean(
    draft.name.trim()
    || draft.macAddress.trim()
    || draft.ipAddress.trim()
  );
}

function hasBlockedDeviceDraftContent(
  draft: Omit<BlockedDevice, "id">
): boolean {
  return Boolean(
    draft.name.trim()
    || draft.macAddress.trim()
    || draft.ipAddress.trim()
  );
}

function hasUnsavedConnectionChanges(router: RouterRecord, settings: RouterSettings): boolean {
  return router.local_ip !== settings.ipAddress.trim()
    || router.api_port !== Number(settings.apiPort)
    || router.api_ssl_port !== Number(settings.apiSslPort)
    || router.username !== settings.username.trim()
    || router.connection_mode !== settings.connectionMode
    || settings.password.trim().length > 0;
}

function hasManagementConnectionChanges(partial: Partial<RouterSettings>): boolean {
  return [
    "apiPort",
    "apiSslPort",
    "connectionMode",
    "ipAddress",
    "password",
    "username"
  ].some((key) => key in partial);
}

function accessPolicySyncLabel(status: RouterAccessPolicySyncStatus): string {
  const labels: Record<RouterAccessPolicySyncStatus, string> = {
    conflict: "Conflit entre deux installations",
    offline: "VPS momentanément inaccessible",
    pending: "Synchronisation VPS en attente",
    synced: "Synchronisé avec le VPS"
  };
  return labels[status];
}

function accessActionError(error: unknown, fallback: string): string {
  if (error instanceof RouterServiceError) {
    if (["router_offline", "timeout", "remote_unavailable", "remote_not_configured"].includes(error.code)) {
      return `Routeur inaccessible. ${error.message}`;
    }
    if (error.code === "duplicate_user") return "Équipement déjà présent sur le routeur.";
    return `Action échouée. ${error.message}`;
  }
  return error instanceof Error && error.message.trim()
    ? `Action échouée. ${error.message}`
    : fallback;
}
