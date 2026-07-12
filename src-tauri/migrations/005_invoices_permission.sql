PRAGMA foreign_keys = ON;

UPDATE internal_profiles
SET permissions_json = '["global.home","global.routers","global.subscription","global.invoices","global.settings","router.home","router.plans.read","router.plans.write","router.tickets.read","router.tickets.generate","router.tickets.own","router.files.read","router.files.own","router.report.read","router.report.own","router.clients.read","router.network.read","router.logs.read","router.settings"]',
    updated_at = CURRENT_TIMESTAMP
WHERE account_id = 'account-douma-demo' AND role = 'admin';
