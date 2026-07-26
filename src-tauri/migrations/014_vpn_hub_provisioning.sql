ALTER TABLE vpn_networks ADD COLUMN provisioning_api_url TEXT NOT NULL DEFAULT '';
ALTER TABLE vpn_networks ADD COLUMN provisioning_api_token_encrypted TEXT;
