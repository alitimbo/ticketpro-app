import type {
  RouterConnectionMode,
  RouterManagedResourceManifest,
  RouterManagementAccountResult,
  RouterManagementServicePolicyResult
} from "../../domain/router";

const DEFAULT_MANAGEMENT_USERNAME = "ticketpro-api";
const DEFAULT_VPN_CIDR = "10.250.0.0/16";

type ManagementCredentials = {
  password: string;
  username: string;
};

type ManagementRouterClient = {
  inspectManagedResources(input: {
    authorizedManagementCidrs: readonly string[];
    managementUsername: string;
  }): Promise<RouterManagedResourceManifest>;
  testConnection(): Promise<{ mode: RouterConnectionMode }>;
};

type CurrentRouterClient = {
  applyManagementServicePolicy(input: {
    authorizedCidrs: readonly string[];
    currentPathConfirmed: boolean;
    disableUnusedServices?: boolean;
  }): Promise<RouterManagementServicePolicyResult>;
  upsertManagementAccount(input: {
    adoptExisting?: boolean;
    password: string;
    username: string;
  }): Promise<RouterManagementAccountResult>;
  inspectManagedResources?(input: {
    authorizedManagementCidrs: readonly string[];
    managementUsername: string;
  }): Promise<RouterManagedResourceManifest>;
  testConnection(): Promise<{ mode: RouterConnectionMode }>;
};

export type PreparedRouterManagementSecurity = {
  accountAction: RouterManagementAccountResult["action"];
  authorizedCidrs: string[];
  connectionMode: "local" | "vpn";
  groupName: string;
  username: string;
};

export type AppliedRouterManagementSecurity = PreparedRouterManagementSecurity & {
  manifest: RouterManagedResourceManifest;
  policy: RouterManagementServicePolicyResult;
};

export class RouterManagementSecurityService {
  private prepared: {
    candidate: ManagementRouterClient;
    credentials: ManagementCredentials | null;
    result: PreparedRouterManagementSecurity;
  } | null = null;

  constructor(private readonly dependencies: {
    commitCredentials(credentials: ManagementCredentials): Promise<void>;
    createCandidateClient(credentials: ManagementCredentials): Promise<ManagementRouterClient>;
    currentClient: CurrentRouterClient;
  }) {}

  async prepare(input: {
    adoptExisting?: boolean;
    localRouterIp: string;
    password?: string;
    username?: string;
  }): Promise<PreparedRouterManagementSecurity> {
    this.prepared = null;
    await this.dependencies.currentClient.testConnection();

    const credentials = {
      password: input.password?.trim() || generateRouterManagementPassword(),
      username: input.username?.trim() || DEFAULT_MANAGEMENT_USERNAME
    };
    const account = await this.dependencies.currentClient.upsertManagementAccount({
      adoptExisting: input.adoptExisting,
      password: credentials.password,
      username: credentials.username
    });
    const candidate = await this.dependencies.createCandidateClient(credentials);
    const connection = await candidate.testConnection();

    const confirmedMode = requireSafeManagementMode(connection.mode);

    const result: PreparedRouterManagementSecurity = {
      accountAction: account.action,
      authorizedCidrs: buildAuthorizedManagementCidrs(input.localRouterIp),
      connectionMode: confirmedMode,
      groupName: account.groupName,
      username: account.username
    };
    this.prepared = { candidate, credentials, result };
    return structuredClone(result);
  }

  async prepareExisting(input: {
    localRouterIp: string;
    username?: string;
  }): Promise<PreparedRouterManagementSecurity> {
    this.prepared = null;
    const username = input.username?.trim() || DEFAULT_MANAGEMENT_USERNAME;
    if (!this.dependencies.currentClient.inspectManagedResources) {
      throw new Error("Le contrôle du compte RouterOS existant est indisponible.");
    }
    const connection = await this.dependencies.currentClient.testConnection();
    const confirmedMode = requireSafeManagementMode(connection.mode);
    const authorizedCidrs = buildAuthorizedManagementCidrs(input.localRouterIp);
    const manifest = await this.dependencies.currentClient.inspectManagedResources({
      authorizedManagementCidrs: authorizedCidrs,
      managementUsername: username
    });
    const accountResources = manifest.resources.filter((resource) =>
      resource.kind === "management_account"
    );
    if (
      accountResources.length < 2
      || accountResources.some((resource) => resource.state !== "present")
    ) {
      throw new Error("Le compte RouterOS dédié présente une dérive et doit être réparé avec le compte administrateur.");
    }

    const candidate: ManagementRouterClient = {
      inspectManagedResources: (options) =>
        this.dependencies.currentClient.inspectManagedResources!(options),
      testConnection: () => this.dependencies.currentClient.testConnection()
    };
    const result: PreparedRouterManagementSecurity = {
      accountAction: "updated",
      authorizedCidrs,
      connectionMode: confirmedMode,
      groupName: DEFAULT_MANAGEMENT_USERNAME,
      username
    };
    this.prepared = { candidate, credentials: null, result };
    return structuredClone(result);
  }

  async apply(): Promise<AppliedRouterManagementSecurity> {
    if (!this.prepared) {
      throw new Error(
        "Préparez et testez d'abord le compte RouterOS dédié. Aucune restriction n'a été appliquée."
      );
    }

    const policy = await this.dependencies.currentClient.applyManagementServicePolicy({
      authorizedCidrs: this.prepared.result.authorizedCidrs,
      currentPathConfirmed: true,
      disableUnusedServices: true
    });

    // A service policy is considered successful only if the dedicated account
    // still reaches RouterOS after the restrictions have been applied.
    await this.prepared.candidate.testConnection();
    const manifest = await this.prepared.candidate.inspectManagedResources({
      authorizedManagementCidrs: this.prepared.result.authorizedCidrs,
      managementUsername: this.prepared.result.username
    });
    if (this.prepared.credentials) {
      await this.dependencies.commitCredentials(this.prepared.credentials);
    }

    const result = {
      ...this.prepared.result,
      manifest,
      policy
    };
    this.prepared = null;
    return structuredClone(result);
  }
}

export function buildAuthorizedManagementCidrs(localRouterIp: string): string[] {
  const cidrs = new Set<string>([DEFAULT_VPN_CIDR]);
  const octets = localRouterIp.trim().split(".").map(Number);
  if (
    octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    cidrs.add(`${octets[0]}.${octets[1]}.${octets[2]}.0/24`);
  }
  return [...cidrs].sort();
}

export function generateRouterManagementPassword(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Le générateur cryptographique Windows est indisponible.");
  }
  const random = new Uint8Array(24);
  globalThis.crypto.getRandomValues(random);
  return `tp-${[...random].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function requireSafeManagementMode(mode: RouterConnectionMode): "local" | "vpn" {
  if (mode === "local" || mode === "vpn") return mode;
  throw new Error(
    "Le compte dédié existe, mais son accès doit être vérifié en local ou via le VPN avant de restreindre les services RouterOS."
  );
}
