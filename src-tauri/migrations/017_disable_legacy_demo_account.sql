-- Conserve les anciennes données de démonstration, mais libère l'adresse qui
-- peut appartenir à un vrai client et bloque toute connexion au compte démo.
UPDATE accounts
SET
  email = 'legacy-demo-disabled@ticketpro.local',
  status = 'suspended',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'account-douma-demo'
  AND email = 'doumacorporation@gmail.com';
