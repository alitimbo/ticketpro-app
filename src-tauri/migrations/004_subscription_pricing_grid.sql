PRAGMA foreign_keys = ON;

ALTER TABLE subscription_plans ADD COLUMN price_per_router_cfa INTEGER;
ALTER TABLE subscription_plans ADD COLUMN description TEXT;
ALTER TABLE subscription_plans ADD COLUMN is_recommended INTEGER NOT NULL DEFAULT 0;

ALTER TABLE account_subscriptions ADD COLUMN price_per_router_cfa_snapshot INTEGER;

INSERT OR IGNORE INTO accounts (
  id,
  email,
  password_hash,
  display_name,
  company_name,
  phone,
  status
)
VALUES (
  'account-douma-demo',
  'doumacorporation@gmail.com',
  'c82cac2bde74b84c9705468afab1cc9f33b62fba4114475fe3eed7db1a4f7121',
  'Douma Corporation',
  'Douma Corporation',
  NULL,
  'active'
);

INSERT OR IGNORE INTO subscription_plans (
  id,
  name,
  router_limit,
  price_cfa,
  price_per_router_cfa,
  billing_period,
  description,
  is_recommended,
  is_active
)
VALUES
  (
    'subscription-plan-1-router',
    'Pack 1 routeur',
    1,
    1500,
    1500,
    'monthly',
    'Ideal pour un seul site WiFi ou une petite zone.',
    0,
    1
  ),
  (
    'subscription-plan-5-routers',
    'Pack 5 routeurs',
    5,
    6000,
    1200,
    'monthly',
    'Adapte aux petits exploitants qui gerent plusieurs zones WiFi.',
    1,
    1
  ),
  (
    'subscription-plan-10-routers',
    'Pack 10 routeurs',
    10,
    10000,
    1000,
    'monthly',
    'Pour les gerants en croissance ou les techniciens qui suivent plusieurs clients.',
    0,
    1
  ),
  (
    'subscription-plan-50-routers',
    'Pack 50 routeurs',
    50,
    40000,
    800,
    'monthly',
    'Pour les reseaux multi-sites, techniciens et exploitants avances.',
    0,
    1
  ),
  (
    'subscription-plan-100-routers',
    'Pack 100 routeurs',
    100,
    70000,
    700,
    'monthly',
    'Pour les gros exploitants, revendeurs ou gestionnaires de nombreux sites.',
    0,
    1
  );

UPDATE subscription_plans
SET
  price_cfa = 1500,
  price_per_router_cfa = 1500,
  billing_period = 'monthly',
  description = 'Ideal pour un seul site WiFi ou une petite zone.',
  is_recommended = 0,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-plan-1-router';

UPDATE subscription_plans
SET
  price_cfa = 6000,
  price_per_router_cfa = 1200,
  billing_period = 'monthly',
  description = 'Adapte aux petits exploitants qui gerent plusieurs zones WiFi.',
  is_recommended = 1,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-plan-5-routers';

UPDATE subscription_plans
SET
  price_cfa = 10000,
  price_per_router_cfa = 1000,
  billing_period = 'monthly',
  description = 'Pour les gerants en croissance ou les techniciens qui suivent plusieurs clients.',
  is_recommended = 0,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-plan-10-routers';

UPDATE subscription_plans
SET
  price_cfa = 40000,
  price_per_router_cfa = 800,
  billing_period = 'monthly',
  description = 'Pour les reseaux multi-sites, techniciens et exploitants avances.',
  is_recommended = 0,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-plan-50-routers';

UPDATE subscription_plans
SET
  price_cfa = 70000,
  price_per_router_cfa = 700,
  billing_period = 'monthly',
  description = 'Pour les gros exploitants, revendeurs ou gestionnaires de nombreux sites.',
  is_recommended = 0,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-plan-100-routers';

UPDATE account_subscriptions
SET
  router_limit_snapshot = 1,
  price_cfa_snapshot = 1500,
  price_per_router_cfa_snapshot = 1500,
  payment_status = COALESCE(payment_status, 'manual'),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'subscription-douma-demo-current';

UPDATE account_subscriptions
SET price_per_router_cfa_snapshot = (
  SELECT subscription_plans.price_per_router_cfa
  FROM subscription_plans
  WHERE subscription_plans.id = account_subscriptions.subscription_plan_id
)
WHERE price_per_router_cfa_snapshot IS NULL;

INSERT OR IGNORE INTO account_subscriptions (
  id,
  account_id,
  subscription_plan_id,
  status,
  current_period_start,
  current_period_end,
  router_limit_snapshot,
  price_cfa_snapshot,
  payment_status,
  price_per_router_cfa_snapshot
)
VALUES (
  'subscription-douma-demo-current',
  'account-douma-demo',
  'subscription-plan-1-router',
  'active',
  CURRENT_TIMESTAMP,
  datetime('now', '+30 days'),
  1,
  1500,
  'manual',
  1500
);

UPDATE routers
SET
  account_id = COALESCE(account_id, 'account-douma-demo'),
  subscription_counted = COALESCE(subscription_counted, 1),
  created_by_profile_id = COALESCE(created_by_profile_id, 'internal-profile-admin')
WHERE account_id IS NULL OR created_by_profile_id IS NULL OR subscription_counted IS NULL;

UPDATE internal_profiles
SET permissions_json = '["global.home","global.routers","global.subscription","global.invoices","global.settings","router.home","router.plans.read","router.plans.write","router.tickets.read","router.tickets.generate","router.tickets.own","router.files.read","router.files.own","router.report.read","router.report.own","router.clients.read","router.network.read","router.logs.read","router.settings"]',
    updated_at = CURRENT_TIMESTAMP
WHERE account_id = 'account-douma-demo' AND role = 'admin';

INSERT OR IGNORE INTO app_settings (id, key, value)
VALUES
  ('setting-subscription-annual-discount-months', 'subscription_annual_discount_months', '2'),
  ('setting-subscription-annual-billing-enabled', 'subscription_annual_billing_enabled', 'false');

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_recommended ON subscription_plans(is_recommended);
CREATE INDEX IF NOT EXISTS idx_routers_account_subscription ON routers(account_id, subscription_counted);
