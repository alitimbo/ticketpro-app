PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  company_name TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS internal_profiles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'agent', 'guest')),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  UNIQUE (account_id, role)
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  router_limit INTEGER NOT NULL,
  price_cfa INTEGER,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  subscription_plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'expired', 'suspended', 'cancelled')),
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  router_limit_snapshot INTEGER NOT NULL,
  price_cfa_snapshot INTEGER,
  payment_status TEXT NOT NULL DEFAULT 'manual' CHECK (payment_status IN ('paid', 'unpaid', 'pending', 'manual')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  subscription_id TEXT REFERENCES account_subscriptions(id),
  invoice_number TEXT NOT NULL UNIQUE,
  amount_cfa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'cancelled')),
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE routers ADD COLUMN account_id TEXT;
ALTER TABLE routers ADD COLUMN subscription_counted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE routers ADD COLUMN created_by_profile_id TEXT;

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

INSERT OR IGNORE INTO internal_profiles (
  id,
  account_id,
  role,
  display_name,
  password_hash,
  is_enabled,
  permissions_json
)
VALUES
  (
    'internal-profile-admin',
    'account-douma-demo',
    'admin',
    'Admin',
    '9ffcea3caee6f051052df3849808f6dae17469a14cab1a5c55e59d4a9f37ba2a',
    1,
    '["global.home","global.routers","global.settings","router.home","router.plans.read","router.tickets.read","router.tickets.generate","router.tickets.own","router.files.read","router.files.own","router.report.read","router.report.own","router.clients.read","router.network.read","router.logs.read","router.settings"]'
  ),
  (
    'internal-profile-operator',
    'account-douma-demo',
    'operator',
    'Opérateur',
    '7a70d720fa2c11cfcc79e2a62c761079f7e5c1e1a38d80c16f0d03cbdf3b8e2b',
    1,
    '["global.home","global.routers","router.home","router.plans.read","router.tickets.read","router.tickets.generate","router.files.read","router.report.read","router.clients.read","router.settings"]'
  ),
  (
    'internal-profile-agent',
    'account-douma-demo',
    'agent',
    'Agent',
    '5eb5817ce535bec90e2cbcf587591b259ef8ec6f3d2c7fa7d26611bd04b9fefc',
    1,
    '["global.home","global.routers","router.home","router.tickets.generate","router.tickets.own","router.files.own","router.report.own"]'
  ),
  (
    'internal-profile-guest',
    'account-douma-demo',
    'guest',
    'Invité',
    '57fe88bc34ce4f2b7e3e7b2bd951259b2cb96e410819f809fe28f71ea4e19f15',
    1,
    '["global.home","router.home","router.tickets.read","router.report.read","router.network.read"]'
  );

INSERT OR IGNORE INTO subscription_plans (
  id,
  name,
  router_limit,
  price_cfa,
  billing_period,
  is_active
)
VALUES
  ('subscription-plan-1-router', 'Pack 1 routeur', 1, 1500, 'monthly', 1),
  ('subscription-plan-5-routers', 'Pack 5 routeurs', 5, NULL, 'monthly', 1),
  ('subscription-plan-10-routers', 'Pack 10 routeurs', 10, NULL, 'monthly', 1),
  ('subscription-plan-50-routers', 'Pack 50 routeurs', 50, NULL, 'monthly', 1),
  ('subscription-plan-100-routers', 'Pack 100 routeurs', 100, NULL, 'monthly', 1);

INSERT OR IGNORE INTO account_subscriptions (
  id,
  account_id,
  subscription_plan_id,
  status,
  current_period_start,
  current_period_end,
  router_limit_snapshot,
  price_cfa_snapshot,
  payment_status
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
  'manual'
);

UPDATE routers
SET
  account_id = COALESCE(account_id, 'account-douma-demo'),
  subscription_counted = COALESCE(subscription_counted, 1),
  created_by_profile_id = COALESCE(created_by_profile_id, 'internal-profile-admin')
WHERE account_id IS NULL OR created_by_profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_internal_profiles_account_id ON internal_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_account_subscriptions_account_id ON account_subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_account_id ON billing_invoices(account_id);
CREATE INDEX IF NOT EXISTS idx_routers_account_id ON routers(account_id);
