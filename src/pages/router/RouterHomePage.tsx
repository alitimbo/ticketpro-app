import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Cpu,
  FileText,
  Gauge,
  HardDrive,
  Radio,
  RefreshCw,
  Router,
  Server,
  Ticket,
  Users,
  Wifi
} from 'lucide-react'
import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotServer,
  HotspotUser,
  RouterDateTime,
  RouterHealth,
  RouterSystemInfo
} from '../../domain/router'
import type { RouterRecord } from '../../domain/database'
import { useAuth } from '../../app/auth/AuthProvider'
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterManagedResourceManifestRepository,
  RouterRepository,
  TicketRepository,
  useAppDatabase
} from '../../services/database'
import {
  buildAuthorizedManagementCidrs,
  createPersistedRouterService,
  FakeRouterAdapter,
  RouterService,
  RouterServiceError
} from '../../services/router'
import {
  defaultRouterAccessPolicy,
  RouterAccessPolicyService,
  type RouterAccessPolicy
} from '../../services/access'
import {
  compareLocalAndRouterTickets,
  SyncObservabilityService,
  type SyncObservabilityReport,
  type TicketSyncSummary
} from '../../services/sync'
import {
  AsyncStateCard,
  Badge,
  Button,
  Card,
  DataListItem,
  PageHeader,
  StatCard,
  StatusDot
} from '../../shared/ui'
import {
  buildRouterHomeIndicators,
  formatBytes,
  getRouterQuickActions,
  shouldShowDeviceProtectionNotice
} from './routerHomeModel'
import { createDemoTickets, ticketFromRecord } from './ticketsPageModel'

type RouterDashboardData = {
  activeUsers: ActiveHotspotUser[]
  dateTime: RouterDateTime
  generatedPdfCount: number
  health: RouterHealth
  localVoucherCount: number
  plans: HotspotPlan[]
  routerName: string
  servers: HotspotServer[]
  systemInfo: RouterSystemInfo
  /** Every Hotspot user; read after the first display, null while loading. */
  users: HotspotUser[] | null
}

export function RouterHomePage () {
  const navigate = useNavigate()
  const { routerId = '' } = useParams()
  const { session, userCan } = useAuth()
  const routerSessionScope = session
    ? JSON.stringify({
        accountId: session.account_id,
        email: session.account_email,
        permissions: session.permissions,
        profileId: session.internal_profile_id,
        profileLabel: session.internal_profile_label,
        profileRole: session.internal_profile_role
      })
    : null
  // Activity tracking refreshes the session timestamps frequently. Router
  // loading only depends on identity and permissions, so keep this reference
  // stable while those values remain unchanged.
  const routerSession = useMemo(() => session, [routerSessionScope])
  const { database, isInitialized, isPersistent } = useAppDatabase()
  const routerRepository = useMemo(
    () => new RouterRepository(database),
    [database]
  )
  const connectionRepository = useMemo(
    () => new RouterConnectionRepository(database),
    [database]
  )
  const ticketRepository = useMemo(
    () => new TicketRepository(database),
    [database]
  )
  const planRepository = useMemo(
    () => new HotspotPlanRepository(database),
    [database]
  )
  const generatedFileRepository = useMemo(
    () => new GeneratedFileRepository(database),
    [database]
  )
  const managedResourceManifestRepository = useMemo(
    () => new RouterManagedResourceManifestRepository(database),
    [database]
  )
  const accessPolicyService = useMemo(
    () => new RouterAccessPolicyService(database),
    [database]
  )
  const syncObservabilityService = useMemo(
    () => new SyncObservabilityService(database),
    [database]
  )
  const [dashboard, setDashboard] = useState<RouterDashboardData | null>(null)
  const [accessPolicy, setAccessPolicy] = useState<RouterAccessPolicy | null>(
    null
  )
  const [cpuLoad, setCpuLoad] = useState(0)
  const [connectionMessage, setConnectionMessage] =
    useState('Connexion en cours')
  const [connectionStatus, setConnectionStatus] =
    useState<'active' | 'offline' | 'warning'>('warning')
  const [syncSummary, setSyncSummary] = useState<TicketSyncSummary | null>(null)
  const [syncReport, setSyncReport] =
    useState<SyncObservabilityReport | null>(null)
  const [managedProfileNames, setManagedProfileNames] = useState<string[]>([])
  const [repairStatus, setRepairStatus] =
    useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [service, setService] = useState<RouterService | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  )
  const [reloadToken, setReloadToken] = useState(0)
  const [reloadAttempt, setReloadAttempt] = useState(0)
  const [lastLiveAt, setLastLiveAt] = useState<string | null>(null)
  const actions = session
    ? getRouterQuickActions(session.internal_profile_role, routerId)
    : []
  const canCreateTickets = userCan('router.tickets.generate')
  const canRepairVoucherLifecycle =
    userCan('router.settings') || userCan('router.settings.manage')

  useEffect(() => {
    let isMounted = true

    async function loadDashboard () {
      if (!routerSession || !routerId || (isPersistent && !isInitialized)) {
        return
      }

      setLoadStatus('loading')
      setLoadError(null)

      try {
        let activeService: RouterService
        let localTickets = createDemoTickets()
        let loadedAccessPolicy = structuredClone(defaultRouterAccessPolicy)
        let generatedPdfCount = 0
        let routerName = 'Routeur de démonstration'
        let loadedManagedProfileNames: string[] = []
        let persistedRouter: RouterRecord | null = null

        if (isPersistent) {
          const router = await routerRepository.findById(routerId)
          if (!router || router.account_id !== routerSession.account_id) {
            throw new Error('Routeur introuvable pour cette organisation.')
          }
          persistedRouter = router
          const [connections, ticketRecords, planRecords, generatedFiles] =
            await Promise.all([
            connectionRepository.listByRouter(routerId),
            ticketRepository.listByRouter(routerId),
            planRepository.listByRouter(routerId),
            generatedFileRepository.listByAccount(routerSession.account_id)
          ])
          routerName = router.name
          generatedPdfCount = generatedFiles.filter(
            file =>
              file.router_id === routerId &&
              file.format.toLowerCase() === 'pdf'
          ).length
          const policy = await accessPolicyService
            .get(routerSession.account_id, routerId)
            .catch(() => structuredClone(defaultRouterAccessPolicy))
          loadedAccessPolicy = policy
          const plansById = new Map(planRecords.map(plan => [plan.id, plan]))
          loadedManagedProfileNames = planRecords
            .filter(plan => !plan.deleted_at)
            .map(plan => plan.mikrotik_profile_name?.trim() || plan.name.trim())
            .filter(Boolean)
          localTickets = ticketRecords.map(ticket =>
            ticketFromRecord(
              ticket,
              plansById.get(ticket.plan_id) ?? null,
              router.name
            )
          )
          activeService = await createPersistedRouterService({
            authSession: routerSession,
            connections,
            database,
            router
          })
        } else {
          activeService = new RouterService({
            adapter: new FakeRouterAdapter({ latencyMs: 0 })
          })
        }

        // The page shows as soon as the light reads answer. The full list of
        // Hotspot users (thousands on a busy router, the largest RouterOS
        // answer) is read afterwards so it never holds the whole page. A
        // deadline ends the spinner: the page then retries on its own.
        const [
          systemInfo,
          servers,
          plans,
          activeUsers,
          health,
          dateTime
        ] = await withDeadline(
          Promise.all([
            activeService.getSystemInfo(),
            activeService.getHotspotServers(),
            activeService.getHotspotPlans(),
            activeService.listActiveUsers(),
            activeService.getRouterHealth(),
            activeService.getRouterDateTime()
          ]),
          routerHomeFirstLoadDeadlineMs,
          'Le routeur ne répond pas assez vite. Nouvelle tentative automatique…'
        )
        const observedAt = new Date().toISOString()
        const observabilityReport = isPersistent
          ? await syncObservabilityService.inspect({
              accountId: routerSession.account_id,
              liveRouterObservedAt: observedAt,
              liveTicketsObservedAt: observedAt,
              now: observedAt,
              routerId
            }).catch(() => null)
          : null

        if (!isMounted) {
          return
        }

        setService(activeService)
        setManagedProfileNames(loadedManagedProfileNames)
        setAccessPolicy(loadedAccessPolicy)
        setDashboard({
          activeUsers,
          dateTime,
          generatedPdfCount,
          health,
          localVoucherCount: localTickets.length,
          plans,
          routerName,
          servers,
          systemInfo,
          users: null
        })
        setSyncSummary(null)
        void activeService.listHotspotUsersForVerification().then(users => {
          if (!isMounted) return
          setDashboard(current => (current ? { ...current, users } : current))
          setSyncSummary(
            compareLocalAndRouterTickets(localTickets, users, activeUsers).summary
          )
        }).catch(() => undefined)
        setCpuLoad(health.cpuLoad)
        setConnectionMessage('En ligne')
        setConnectionStatus('active')
        setLastLiveAt(observedAt)
        setReloadAttempt(0)
        setSyncReport(observabilityReport)
        setLoadError(null)
        setLoadStatus('ready')

        if (isPersistent && persistedRouter) {
          const manifestRouter = persistedRouter
          void activeService.inspectManagedResources({
            authorizedManagementCidrs:
              manifestRouter.username === 'ticketpro-api'
                ? buildAuthorizedManagementCidrs(manifestRouter.local_ip)
                : [],
            managementUsername:
              manifestRouter.username === 'ticketpro-api'
                ? manifestRouter.username
                : null,
            managedHotspotProfileNames: loadedManagedProfileNames,
            wireguardInterfaceName:
              manifestRouter.connection_mode === 'vpn'
                ? 'ticketpro-vpn'
                : null
          }).then(async manifest => {
            await managedResourceManifestRepository.save(
              routerSession.account_id,
              routerId,
              manifest
            )
            return syncObservabilityService.inspect({
              accountId: routerSession.account_id,
              liveRouterObservedAt: observedAt,
              liveTicketsObservedAt: observedAt,
              now: new Date().toISOString(),
              routerId
            })
          }).then(report => {
            if (isMounted) setSyncReport(report)
          }).catch(async error => {
            await managedResourceManifestRepository
              .markError(routerSession.account_id, routerId, error)
              .catch(() => undefined)
            if (!isMounted) return
            const report = await syncObservabilityService.inspect({
              accountId: routerSession.account_id,
              liveRouterObservedAt: observedAt,
              liveTicketsObservedAt: observedAt,
              now: new Date().toISOString(),
              routerId
            }).catch(() => null)
            if (isMounted && report) setSyncReport(report)
          })
        }
      } catch (error) {
        if (isMounted) {
          setDashboard(null)
          setService(null)
          setConnectionMessage('Hors ligne')
          setConnectionStatus('offline')
          setReloadAttempt(current => current + 1)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Impossible de charger le routeur.'
          )
          setLoadStatus('error')
        }
      }
    }

    void loadDashboard()

    return () => {
      isMounted = false
    }
  }, [
    accessPolicyService,
    connectionRepository,
    database,
    generatedFileRepository,
    isInitialized,
    isPersistent,
    managedResourceManifestRepository,
    planRepository,
    reloadToken,
    routerId,
    routerRepository,
    routerSession,
    syncObservabilityService,
    ticketRepository
  ])

  useEffect(() => {
    if (!service) {
      return undefined
    }
    let cancelled = false
    let running = false
    let timer: number | undefined
    let consecutiveFailures = 0
    // The first load already read the user list in the background.
    let cycle = 1

    // Sequential live loop: never two reads at once, results of a previous
    // router or of an unmounted view are dropped. Router health tells whether
    // the router is reachable; sessions and vouchers tell whether the data is
    // fresh. The last valid data stays on screen with its age.
    const refreshLive = async () => {
      if (cancelled || running) return
      window.clearTimeout(timer)
      if (document.visibilityState !== 'hidden') {
        running = true
        // Health and sessions every pass; the full user list (heavy) only
        // every few passes.
        const readUsers = cycle % routerLiveUsersEveryCycles === 0
        cycle += 1
        const [health, activeUsers, users] = await Promise.allSettled([
          service.getRouterHealth(),
          service.listActiveUsers(),
          readUsers ? service.listHotspotUsersForVerification() : Promise.resolve(null)
        ])
        running = false
        if (cancelled) return
        const observedAt = new Date().toISOString()
        if (
          health.status === 'fulfilled' &&
          activeUsers.status === 'fulfilled' &&
          users.status === 'fulfilled'
        ) {
          consecutiveFailures = 0
          setCpuLoad(health.value.cpuLoad)
          setDashboard(current =>
            current
              ? {
                  ...current,
                  activeUsers: activeUsers.value,
                  health: health.value,
                  users: users.value ?? current.users
                }
              : current
          )
          setLastLiveAt(observedAt)
          setConnectionMessage('En ligne')
          setConnectionStatus('active')
        } else {
          consecutiveFailures += 1
          if (health.status === 'fulfilled') {
            setCpuLoad(health.value.cpuLoad)
            setDashboard(current =>
              current ? { ...current, health: health.value } : current
            )
            setConnectionMessage('Données non actualisées')
            setConnectionStatus('warning')
          } else {
            setConnectionMessage('Hors ligne')
            setConnectionStatus('offline')
          }
        }
        if (isPersistent && routerSession) {
          const fresh = activeUsers.status === 'fulfilled' && users.status === 'fulfilled'
          void syncObservabilityService.inspect({
            accountId: routerSession.account_id,
            ...(fresh
              ? { liveRouterObservedAt: observedAt, liveTicketsObservedAt: observedAt }
              : {}),
            now: observedAt,
            routerId
          }).then(report => { if (!cancelled) setSyncReport(report) }).catch(() => undefined)
        }
      }
      if (cancelled) return
      timer = window.setTimeout(
        () => void refreshLive(),
        routerLiveDelayMs(consecutiveFailures)
      )
    }
    const refreshNow = () => void refreshLive()

    timer = window.setTimeout(refreshNow, routerLiveDelayMs(0))
    window.addEventListener('online', refreshNow)
    window.addEventListener('focus', refreshNow)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('online', refreshNow)
      window.removeEventListener('focus', refreshNow)
    }
  }, [isPersistent, routerId, routerSession, service, syncObservabilityService])

  // When the first load failed, retry on its own (bounded backoff) and as
  // soon as the network comes back, without restarting the application.
  useEffect(() => {
    if (loadStatus !== 'error') return undefined
    const timer = window.setTimeout(
      () => setReloadToken(current => current + 1),
      routerReloadDelayMs(reloadAttempt)
    )
    const retryNow = () => setReloadToken(current => current + 1)
    window.addEventListener('online', retryNow)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', retryNow)
    }
  }, [loadStatus, reloadAttempt])

  const testRouter = async () => {
    if (!service) {
      setConnectionMessage('Routeur indisponible')
      setConnectionStatus('offline')
      return
    }

    try {
      await service.testConnection()
      setConnectionMessage('Routeur connecté')
      setConnectionStatus('active')
    } catch (error) {
      setConnectionStatus('offline')
      setConnectionMessage(
        error instanceof RouterServiceError ? error.message : 'Test impossible.'
      )
    }
  }

  const repairVoucherLifecycle = async () => {
    if (!service || managedProfileNames.length === 0) {
      setRepairStatus('error')
      setRepairMessage('Aucun profil TicketPro ne peut être réparé sur ce routeur.')
      return
    }

    setRepairStatus('loading')
    setRepairMessage('Réparation des profils Hotspot en cours…')
    try {
      const result = await service.ensureVoucherLifecycleEngine({
        managedProfileNames
      })
      setRepairStatus('success')
      setRepairMessage(
        `${result.managedProfileCount} profil(s) Hotspot vérifié(s) et réparé(s).`
      )
      setReloadToken(current => current + 1)
    } catch (error) {
      setRepairStatus('error')
      setRepairMessage(
        error instanceof RouterServiceError
          ? error.message
          : 'La réparation RouterOS a échoué.'
      )
    }
  }

  if (!dashboard) {
    return (
      <div className='page-stack'>
        <PageHeader
          actions={
            loadStatus === 'error' ? (
              <Button
                icon={Router}
                onClick={() => navigate('/routeurs')}
                variant='ghost'
              >
                Revenir aux routeurs
              </Button>
            ) : null
          }
          description={loadError ?? 'Chargement des informations du routeur.'}
          eyebrow='Routeur'
          title={loadError ? 'Routeur indisponible' : 'Maison routeur'}
        />
        <AsyncStateCard
          description='TicketPro interroge le MikroTik avant d’afficher les indicateurs de la maison routeur.'
          errorDescription={loadError ?? 'Vérifiez la connexion au routeur, puis relancez la lecture.'}
          errorTitle='Impossible de charger la maison routeur'
          loadingDescription='Lecture du système, du Hotspot, des vouchers, des plans et de l’état matériel.'
          loadingTitle='Chargement des données RouterOS…'
          onRetry={() => setReloadToken(current => current + 1)}
          status={loadStatus === 'error' ? 'error' : 'loading'}
          title='Préparation de la maison routeur'
        />
      </div>
    )
  }

  const hotspotEnabled = dashboard.servers.some(server => server.isEnabled)
  const indicators = buildRouterHomeIndicators({
    activeUsers: dashboard.activeUsers,
    generatedPdfCount: dashboard.generatedPdfCount,
    localVoucherCount: dashboard.localVoucherCount,
    plans: dashboard.plans,
    routerUsers: dashboard.users ?? []
  })
  const memoryPercent = Math.round(
    (dashboard.health.memoryUsed / dashboard.health.memoryTotal) * 100
  )
  const hasSyncWarning = Boolean(
    syncSummary &&
      (syncSummary.conflict > 0 ||
        syncSummary.error > 0 ||
        syncSummary.localMissing > 0 ||
        syncSummary.routerMissing > 0)
  )
  const hasManifestDrift = Boolean(
    syncReport?.alerts.some(alert => alert.code === 'MANIFEST_DRIFT')
  )
  const showDeviceProtectionNotice =
    userCan('router.settings') &&
    shouldShowDeviceProtectionNotice(accessPolicy)

  return (
    <div className='page-stack'>
      <PageHeader
        actions={
          canCreateTickets ? (
            <Button
              icon={Ticket}
              onClick={() =>
                navigate(`/routeurs/${routerId}/tickets/generation`)
              }
              size='large'
              variant='primary'
            >
              Créer des tickets
            </Button>
          ) : null
        }
        description='Vue claire du routeur sélectionné, de ses tickets et de son état actuel.'
        eyebrow='Routeur'
        title={dashboard.routerName}
      />

      {showDeviceProtectionNotice ? (
        <section
          aria-label='Protection des vouchers désactivée'
          className='router-security-notice'
        >
          <div className='router-security-notice__icon'>
            <AlertTriangle aria-hidden='true' />
          </div>
          <div className='router-security-notice__content'>
            <strong>Blocage du partage de connexion incomplet</strong>
            <p>
              Activez le mode strict et le blocage TTL pour empêcher le partage
              derrière un téléphone. Le verrouillage du voucher sur la première
              adresse MAC reste facultatif.
            </p>
          </div>
          <Button
            icon={ArrowRight}
            onClick={() =>
              navigate(
                `/routeurs/${routerId}/parametres?section=anti-partage`
              )
            }
            variant='primary'
          >
            Configurer
          </Button>
        </section>
      ) : null}

      <section className='router-hero'>
        <div className='router-hero__main'>
          <div className='router-card__icon'>
            <Router aria-hidden='true' />
          </div>
          <div>
            <h2>{dashboard.systemInfo.model}</h2>
            <p>{dashboard.systemInfo.identity}</p>
          </div>
        </div>
        <div className='router-hero__states'>
          <StatusDot
            label={
              lastLiveAt && connectionStatus !== 'active'
                ? `${connectionMessage} · dernière synchronisation ${formatLiveTime(lastLiveAt)}`
                : connectionMessage
            }
            status={connectionStatus}
          />
          <Badge status={hotspotEnabled ? 'success' : 'warning'}>
            {hotspotEnabled ? 'Hotspot actif' : 'Hotspot à vérifier'}
          </Badge>
        </div>
      </section>

      <div className='page-grid'>
        <SyncDiagnosticCard
          canRepair={canRepairVoucherLifecycle}
          hasManifestDrift={hasManifestDrift}
          onRepair={() => void repairVoucherLifecycle()}
          repairMessage={repairMessage}
          repairStatus={repairStatus}
          report={syncReport}
        />

        <Card className='span-8' title='Informations routeur'>
          <div className='router-info-grid'>
            <InfoItem label='Nom enregistré' value={dashboard.routerName} />
            <InfoItem label='Modèle' value={dashboard.systemInfo.model} />
            <InfoItem label='Carte' value={dashboard.systemInfo.boardName} />
            <InfoItem
              label='Numéro de série'
              value={dashboard.systemInfo.serialNumber}
            />
            <InfoItem
              label='Version'
              value={dashboard.systemInfo.routerOsVersion}
            />
            <InfoItem
              label='Date et heure'
              value={`${dashboard.dateTime.date} ${dashboard.dateTime.time}`}
            />
          </div>
        </Card>

        <Card className='span-4' title='État temps réel'>
          <div className='router-meter'>
            <div>
              <p>CPU</p>
              <strong>{cpuLoad}%</strong>
            </div>
            <div className='router-meter__bar'>
              <span style={{ width: `${cpuLoad}%` }} />
            </div>
          </div>
          <div className='router-meter'>
            <div>
              <p>Mémoire</p>
              <strong>
                {formatBytes(dashboard.health.memoryUsed)} /{' '}
                {formatBytes(dashboard.health.memoryTotal)}
              </strong>
            </div>
            <div className='router-meter__bar'>
              <span style={{ width: `${memoryPercent}%` }} />
            </div>
          </div>
        </Card>

        <div className='span-4'>
          <StatCard
            icon={Activity}
            label='Clients connectés'
            value={String(indicators.connectedClientCount)}
            hint='Sessions Hotspot actives'
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={Ticket}
            label='Vouchers locaux'
            value={String(indicators.localVoucherCount)}
            hint='Enregistrés dans TicketPro'
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={FileText}
            label='Plans actifs'
            value={String(indicators.activePlanCount)}
            hint={`${indicators.routerPlanCount} profil(s) RouterOS détecté(s)`}
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={Users}
            label='Vouchers MikroTik'
            value={dashboard.users === null ? '…' : String(indicators.routerVoucherCount)}
            hint={dashboard.users === null ? 'Lecture des comptes Hotspot…' : 'Comptes Hotspot présents sur le routeur'}
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={FileText}
            label='PDF générés'
            value={String(indicators.generatedPdfCount)}
            hint='Fichiers archivés pour ce routeur'
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={CalendarClock}
            label='Disponibilité routeur'
            value={dashboard.health.uptime}
            hint='Temps de fonctionnement RouterOS'
          />
        </div>
        <div className='span-4'>
          <StatCard
            icon={RefreshCw}
            label='Tickets vérifiés'
            value={
              syncSummary
                ? `${syncSummary.routerSynced}/${syncSummary.totalLocal}`
                : 'À vérifier'
            }
            hint={
              syncSummary
                ? `${syncSummary.routerMissing} absent(s) routeur`
                : 'Synchronisation non lancée'
            }
          />
        </div>

        <Card className='span-8' title='État du routeur'>
          <div className='data-list'>
            <DataListItem
              description={`${dashboard.activeUsers.length} client(s) connecté(s), ${dashboard.users === null ? 'lecture des' : dashboard.users.length} utilisateur(s) Hotspot.`}
              icon={Wifi}
              meta={<StatusDot label='Connecté' status='active' />}
              title='Connexion'
            />
            <DataListItem
              description={dashboard.servers
                .map(server => `${server.name} sur ${server.interfaceName}`)
                .join(', ')}
              icon={Radio}
              meta={
                <Badge status={hotspotEnabled ? 'success' : 'warning'}>
                  {hotspotEnabled ? 'Actif' : 'À vérifier'}
                </Badge>
              }
              title='Hotspot'
            />
            <DataListItem
              description={`${formatBytes(
                dashboard.health.memoryUsed
              )} utilisés sur ${formatBytes(dashboard.health.memoryTotal)}.`}
              icon={HardDrive}
              meta={<Badge status='active'>{memoryPercent}%</Badge>}
              title='Mémoire'
            />
            <DataListItem
              description={
                syncSummary
                  ? `${syncSummary.routerSynced} ticket(s) confirmé(s), ${syncSummary.routerMissing} absent(s) du routeur, ${syncSummary.localMissing} absent(s) localement.`
                  : "La comparaison avec le routeur n'a pas encore été lancée."
              }
              icon={RefreshCw}
              meta={
                <Badge status={hasSyncWarning ? 'warning' : 'success'}>
                  {hasSyncWarning ? 'À vérifier' : 'À jour'}
                </Badge>
              }
              title='Synchronisation tickets'
            />
          </div>
        </Card>

      </div>
    </div>
  )
}

type SyncDiagnosticCardProps = {
  canRepair: boolean
  hasManifestDrift: boolean
  onRepair: () => void
  repairMessage: string | null
  repairStatus: 'idle' | 'loading' | 'success' | 'error'
  report: SyncObservabilityReport | null
}

function SyncDiagnosticCard ({
  canRepair,
  hasManifestDrift,
  onRepair,
  repairMessage,
  repairStatus,
  report
}: SyncDiagnosticCardProps) {
  const routerFreshness = report?.freshness.find(item => item.id === 'router')

  return (
    <Card
      className='span-12 router-sync-diagnostic-card'
      description='Suivi de la file durable, des données RouterOS et du cycle des vouchers.'
      title='Synchronisation et diagnostic'
    >
      <div className='router-sync-diagnostic-grid'>
        <DataListItem
          description={
            report
              ? `${report.queue.pending + report.queue.processing + report.queue.retry} en attente, ${report.queue.failed + report.queue.conflict} à vérifier.${report.incidents[0] ? ` Dernière trace : ${report.incidents[0].correlationId}.` : ''}`
              : 'Diagnostic local en cours de préparation.'
          }
          icon={RefreshCw}
          meta={
            <Badge status={report?.status ?? 'warning'}>
              {report?.statusLabel ?? 'Lecture…'}
            </Badge>
          }
          title='File durable'
        />
        <DataListItem
          description={
            routerFreshness?.message ??
            "Aucune mesure de fraîcheur n'est encore disponible."
          }
          icon={Gauge}
          meta={
            <Badge status={routerFreshness?.status ?? 'warning'}>
              {routerFreshness?.status === 'success' ? 'Récent' : 'À vérifier'}
            </Badge>
          }
          title='Fraîcheur RouterOS'
        />
        {report?.alerts.length ? (
          report.alerts.slice(0, 5).map(alert => (
            <DataListItem
              description={alert.message}
              icon={AlertTriangle}
              key={alert.code}
              meta={
                <Badge status={alert.status}>
                  {alert.status === 'error' ? 'Action requise' : 'À vérifier'}
                </Badge>
              }
              title={alert.title}
            />
          ))
        ) : (
          <DataListItem
            description='Aucun conflit ni échec de synchronisation détecté.'
            icon={AlertTriangle}
            meta={<Badge status='success'>Aucune alerte</Badge>}
            title='Contrôle de cohérence'
          />
        )}
      </div>

      <div className='router-sync-diagnostic-actions'>
        <span className='muted-inline'>
          {!canRepair
            ? "Réparation réservée au propriétaire ou à un Admin de l'organisation."
            : repairMessage ??
              (hasManifestDrift
                ? 'TicketPro peut réparer ses extensions sans modifier les scripts externes.'
                : 'Le cycle des vouchers est conforme au dernier contrôle. Vous pouvez le revérifier à tout moment.')}
        </span>
        <Button
          disabled={!canRepair || repairStatus === 'loading'}
          icon={RefreshCw}
          onClick={onRepair}
          variant={repairStatus === 'error' ? 'danger' : 'secondary'}
        >
          {repairStatus === 'loading'
            ? 'Réparation…'
            : 'Réparer le cycle des vouchers'}
        </Button>
      </div>
    </Card>
  )
}

function InfoItem ({ label, value }: { label: string; value: string }) {
  return (
    <div className='router-info-item'>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function iconForAction (actionId: string) {
  const icons = {
    clients: Users,
    createTickets: Ticket,
    report: FileText,
    testRouter: Gauge,
    tickets: Server
  }

  return icons[actionId as keyof typeof icons] ?? Activity
}

/** Live cadence: 15 s when healthy, 5 s then 10 s after failures, never above 30 s. */
/** First display deadline: past it the page stops spinning and retries. */
export const routerHomeFirstLoadDeadlineMs = 25_000

/** The full Hotspot user list is re-read every 4 live passes (about 1 min). */
export const routerLiveUsersEveryCycles = 4

export function withDeadline<T> (
  promise: Promise<T>,
  deadlineMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), deadlineMs)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

export function routerLiveDelayMs (consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 15_000
  return Math.min(30_000, 5_000 * 2 ** (consecutiveFailures - 1))
}

/** First-load retries: 5 s, 10 s, 20 s, then every 30 s. */
export function routerReloadDelayMs (attempt: number): number {
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, attempt - 1))
}

function formatLiveTime (iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(iso))
}
