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
import { useAuth } from '../../app/auth/AuthProvider'
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketRepository,
  useAppDatabase
} from '../../services/database'
import {
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
  type TicketSyncSummary
} from '../../services/sync'
import {
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
  const accessPolicyService = useMemo(
    () => new RouterAccessPolicyService(database),
    [database]
  )
  const [dashboard, setDashboard] = useState<RouterDashboardData | null>(null)
  const [accessPolicy, setAccessPolicy] = useState<RouterAccessPolicy | null>(
    null
  )
  const [cpuLoad, setCpuLoad] = useState(0)
  const [connectionMessage, setConnectionMessage] =
    useState('Connexion en cours')
  const [syncSummary, setSyncSummary] = useState<TicketSyncSummary | null>(null)
  const [service, setService] = useState<RouterService | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const actions = session
    ? getRouterQuickActions(session.internal_profile_role, routerId)
    : []
  const canCreateTickets = userCan('router.tickets.generate')

  useEffect(() => {
    let isMounted = true

    async function loadDashboard () {
      if (!routerSession || !routerId || (isPersistent && !isInitialized)) {
        return
      }

      try {
        let activeService: RouterService
        let localTickets = createDemoTickets()
        let loadedAccessPolicy = structuredClone(defaultRouterAccessPolicy)
        let generatedPdfCount = 0
        let routerName = 'Routeur de démonstration'

        if (isPersistent) {
          const router = await routerRepository.findById(routerId)
          if (!router || router.account_id !== routerSession.account_id) {
            throw new Error('Routeur introuvable pour cette organisation.')
          }
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

        if (!isMounted) {
          return
        }

        setService(activeService)
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
        setLoadError(null)
      } catch (error) {
        if (isMounted) {
          setDashboard(null)
          setService(null)
          setConnectionMessage('Connexion impossible')
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Impossible de charger le routeur.'
          )
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
    planRepository,
    routerId,
    routerRepository,
    routerSession,
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
          setCpuLoad(health.cpuLoad)
          setDashboard(current =>
            current ? { ...current, activeUsers, health, users } : current
          )
          setConnectionMessage('Routeur connecté')
        })
        .catch(() =>
          setConnectionMessage('Actualisation du routeur impossible')
        )
    }, 15_000)

    return () => window.clearInterval(interval)
  }, [service])

  const testRouter = async () => {
    if (!service) {
      setConnectionMessage('Routeur indisponible')
      return
    }

    try {
      await service.testConnection()
      setConnectionMessage('Routeur connecté')
    } catch (error) {
      setConnectionMessage(
        error instanceof RouterServiceError ? error.message : 'Test impossible.'
      )
    }
  }

  if (!dashboard) {
    return (
      <div className='page-stack'>
        <PageHeader
          description={loadError ?? 'Chargement des informations du routeur.'}
          eyebrow='Routeur'
          title={loadError ? 'Routeur indisponible' : 'Maison routeur'}
        />
        <Card>
          {loadError ? (
            <>
              <p className='form-error'>{loadError}</p>
              <Button
                icon={Router}
                onClick={() => navigate('/routeurs')}
                variant='primary'
              >
                Revenir aux routeurs
              </Button>
            </>
          ) : (
            <StatusDot label='Chargement' status='warning' />
          )}
        </Card>
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
              Activez la protection stricte pour verrouiller les vouchers et
              bloquer le trafic provenant d'appareils connectés derrière un
              téléphone.
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
          <StatusDot label={connectionMessage} status='active' />
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
