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
  users: HotspotUser[]
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

        const [
          systemInfo,
          servers,
          plans,
          users,
          activeUsers,
          health,
          dateTime
        ] = await Promise.all([
          activeService.getSystemInfo(),
          activeService.getHotspotServers(),
          activeService.getHotspotPlans(),
          activeService.listHotspotUsers(),
          activeService.listActiveUsers(),
          activeService.getRouterHealth(),
          activeService.getRouterDateTime()
        ])
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
          users
        })
        setSyncSummary(
          compareLocalAndRouterTickets(localTickets, users, activeUsers).summary
        )
        setCpuLoad(health.cpuLoad)
        setConnectionMessage('Routeur connecté')
        setConnectionStatus('active')
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
          setConnectionMessage('Connexion impossible')
          setConnectionStatus('offline')
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

    const interval = window.setInterval(() => {
      void Promise.all([
        service.getRouterHealth(),
        service.listActiveUsers(),
        service.listHotspotUsers()
      ])
        .then(([health, activeUsers, users]) => {
          const observedAt = new Date().toISOString()
          setCpuLoad(health.cpuLoad)
          setDashboard(current =>
            current ? { ...current, activeUsers, health, users } : current
          )
          setConnectionMessage('Routeur connecté')
          setConnectionStatus('active')
          if (isPersistent && routerSession) {
            void syncObservabilityService.inspect({
              accountId: routerSession.account_id,
              liveRouterObservedAt: observedAt,
              liveTicketsObservedAt: observedAt,
              now: observedAt,
              routerId
            }).then(setSyncReport).catch(() => undefined)
          }
        })
        .catch(() => {
          setConnectionMessage('Actualisation du routeur impossible')
          setConnectionStatus('offline')
          if (isPersistent && routerSession) {
            void syncObservabilityService.inspect({
              accountId: routerSession.account_id,
              now: new Date().toISOString(),
              routerId
            }).then(setSyncReport).catch(() => undefined)
          }
        })
    }, 15_000)

    return () => window.clearInterval(interval)
  }, [isPersistent, routerId, routerSession, service, syncObservabilityService])

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
    routerUsers: dashboard.users
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
          <StatusDot label={connectionMessage} status={connectionStatus} />
          <Badge status={hotspotEnabled ? 'success' : 'warning'}>
            {hotspotEnabled ? 'Hotspot actif' : 'Hotspot à vérifier'}
          </Badge>
        </div>
      </section>

      <div className='page-grid'>
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
            value={String(indicators.routerVoucherCount)}
            hint='Comptes Hotspot présents sur le routeur'
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
              description={`${dashboard.activeUsers.length} client(s) connecté(s), ${dashboard.users.length} utilisateur(s) Hotspot.`}
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

        <Card className='span-4' title='Synchronisation et diagnostic'>
          <div className='data-list'>
            <DataListItem
              description={
                syncReport
                  ? `${syncReport.queue.pending + syncReport.queue.processing + syncReport.queue.retry} en attente, ${syncReport.queue.failed + syncReport.queue.conflict} à vérifier.${syncReport.incidents[0] ? ` Dernière trace : ${syncReport.incidents[0].correlationId}.` : ''}`
                  : 'Diagnostic local en cours de préparation.'
              }
              icon={RefreshCw}
              meta={
                <Badge status={syncReport?.status ?? 'warning'}>
                  {syncReport?.statusLabel ?? 'Lecture…'}
                </Badge>
              }
              title='File durable'
            />
            <DataListItem
              description={
                syncReport?.freshness.find(item => item.id === 'router')?.message ??
                "Aucune mesure de fraîcheur n'est encore disponible."
              }
              icon={Gauge}
              meta={
                <Badge
                  status={
                    syncReport?.freshness.find(item => item.id === 'router')
                      ?.status ?? 'warning'
                  }
                >
                  {syncReport?.freshness.find(item => item.id === 'router')
                    ?.status === 'success'
                    ? 'Récent'
                    : 'À vérifier'}
                </Badge>
              }
              title='Fraîcheur RouterOS'
            />
            {syncReport?.alerts.length ? (
              syncReport.alerts.slice(0, 5).map(alert => (
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
            <div className='button-row'>
              <span className='muted-inline'>
                {!canRepairVoucherLifecycle
                  ? "Réparation réservée au propriétaire ou à un Admin de l'organisation."
                  : repairMessage ??
                    (hasManifestDrift
                      ? 'TicketPro peut réparer ses extensions sans modifier les scripts externes.'
                      : 'Le cycle des vouchers est conforme au dernier contrôle. Vous pouvez le revérifier à tout moment.')}
              </span>
              <Button
                disabled={!canRepairVoucherLifecycle || repairStatus === 'loading'}
                icon={RefreshCw}
                onClick={() => void repairVoucherLifecycle()}
                variant={repairStatus === 'error' ? 'danger' : 'secondary'}
              >
                {repairStatus === 'loading'
                  ? 'Réparation…'
                  : 'Réparer le cycle des vouchers'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
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
