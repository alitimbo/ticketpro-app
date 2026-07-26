PRAGMA foreign_keys = ON;

UPDATE internal_profiles
SET permissions_json = '["global.home","global.routers","global.routers.select","global.routers.manage","global.routers.add","global.routers.edit","global.routers.delete","global.subscription","global.invoices","global.settings","global.settings.profiles","router.home","router.plans.read","router.plans.write","router.tickets.read","router.tickets.generate","router.tickets.own","router.tickets.reprint","router.tickets.disable","router.tickets.delete","router.tickets.sync","router.tickets.revealPassword","router.files.read","router.files.own","router.report.read","router.report.own","router.clients.read","router.clients.disconnect","router.network.read","router.logs.read","router.logs.clean","router.settings","router.settings.manage"]',
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'admin';

UPDATE internal_profiles
SET permissions_json = '["global.home","global.routers","global.routers.select","router.home","router.plans.read","router.tickets.read","router.tickets.generate","router.tickets.reprint","router.files.read","router.report.read","router.clients.read"]',
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'operator';

UPDATE internal_profiles
SET permissions_json = '["global.home","global.routers.select","router.home","router.tickets.generate","router.tickets.own","router.tickets.reprint","router.files.own","router.report.own"]',
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'agent';

UPDATE internal_profiles
SET permissions_json = '["global.home","router.home","router.tickets.read","router.report.read","router.network.read"]',
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'guest';
