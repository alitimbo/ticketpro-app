# Sprint 3 laboratoire — cycle de vie inviolable des vouchers

## Objectif

Valider sur `TicketPro Lab` qu'un voucher ne peut jamais retrouver des compteurs vierges après activation, épuisement ou expiration.

Le test accéléré utilise **1 minute d'utilisation et 3 minutes de validité**. Il reproduit exactement la logique du scénario commercial **1 h / valide 3 h**, sans attendre trois heures.

Nova et le VPS public ne doivent pas être modifiés pendant cette validation.

## Préconditions

- Démarrer la VM `TicketPro Lab`.
- Démarrer TicketPro depuis le code courant avec `npm run tauri:dev` afin d'appliquer la migration SQLite 029.
- Utiliser WinBox vers `10.250.0.2`, via le tunnel TicketPro, avant tout test du portail captif.
- Conserver le bypass d'administration `192.168.88.254`. Ne plus le désactiver depuis une session WinBox qui dépend de cette adresse.
- Prévoir un vrai client Hotspot distinct : seconde VM reliée au réseau `TicketPro-LAN`, téléphone via un point d'accès, ou autre poste de test.

## 1. Mettre le moteur RouterOS à niveau

Dans TicketPro :

1. Ouvrir le routeur `TicketPro Lab`.
2. Modifier le routeur sans changer ses valeurs.
3. Tester la connexion réelle.
4. Enregistrer.

L'enregistrement exécute l'upsert idempotent du moteur de vouchers. Dans WinBox :

```routeros
/system script print detail where name="ticketpro-voucher-expiration-v1"
/system scheduler print detail where name="ticketpro-voucher-expiration-v1"
```

Résultat obligatoire :

- commentaire `TicketPro managed voucher lifecycle v6` ;
- un seul script ;
- un seul scheduler ;
- scheduler actif, intervalle `1m`.

## 2. Créer le plan accéléré

Créer dans TicketPro un plan de laboratoire dédié :

- nom/profil : `tp-lab-1m-valid3m` ;
- durée d'utilisation : `1 minute` ;
- validité après première connexion : `3 minutes` ;
- quota : illimité ;
- appareils : `1` ;
- prix : `0` dans la devise de test.

Ne pas réutiliser un profil commercial existant.

Générer un seul voucher. La confirmation de création met aussi le moteur RouterOS à niveau et fige sur le ticket les snapshots de durée, validité, quota, débits et appareils.

## 3. Vérifier l'état initial

Charger [routeros-sprint3-verify.rsc](./routeros-sprint3-verify.rsc) dans `WinBox > Files`, puis :

```routeros
/import file-name=routeros-sprint3-verify.rsc verbose=yes
```

Le voucher doit avoir :

- `disabled=no` ;
- `uptime=0s` ;
- `limit-uptime=1m` ;
- `expires=0` ;
- `state=new`.

## 4. Première connexion et départ de la validité

Depuis le client Hotspot distinct :

1. Ouvrir le portail captif.
2. Saisir le voucher.
3. Vérifier que la navigation fonctionne.
4. Noter l'heure exacte `T0`.

Dans WinBox, après quelques secondes :

```routeros
/ip hotspot user print detail where name="CODE_DU_TEST"
```

Le commentaire doit maintenant contenir `state=active` et un `expires` non nul. Cette échéance ne doit plus changer, même après une modification du plan.

## 5. Épuisement à une minute

Continuer la navigation jusqu'à consommation de la minute. Attendre au maximum un cycle du scheduler supplémentaire.

Résultats obligatoires :

- le compte Hotspot existe encore ;
- `disabled=yes` ;
- le commentaire contient `state=exhausted` ;
- `uptime` reste à sa valeur consommée et ne revient jamais à zéro ;
- aucune session active du voucher ;
- aucun cookie du voucher ;
- aucune reconnexion possible ;
- l'ouverture d'un site renvoie vers le portail captif, sans accès Internet gratuit.

Dans TicketPro, une synchronisation doit afficher `Consommé/Épuisé`, conserver les compteurs et ne jamais proposer une recréation automatique.

## 6. Suppression à trois minutes

À `T0 + 3 minutes`, attendre au maximum un cycle du scheduler, puis relancer le script de vérification.

Résultats obligatoires :

- le compte Hotspot n'existe plus ;
- aucune session active ;
- aucun cookie ou MAC-cookie ;
- aucun IP Binding appartenant au voucher ;
- le log RouterOS contient `TicketPro voucher removed` ;
- TicketPro conserve le ticket dans les archives ;
- l'historique distingue fin de vie, suppression RouterOS et archivage ;
- le dernier snapshot local connu reste consultable ;
- cliquer sur Réparer/Synchroniser ne recrée jamais ce voucher.

## 7. Test quota

Créer ensuite un plan distinct :

- durée : `10 minutes` ;
- validité : `15 minutes` ;
- quota : `1 Mo` ;
- appareils : `1`.

Télécharger plus de 1 Mo depuis le client. Le résultat attendu est identique à l'épuisement par temps : compte désactivé, sessions/cookies nettoyés, compte conservé jusqu'à la fin des 15 minutes, puis supprimé physiquement.

## 8. Test d'incident de nettoyage

Si un bypass externe correspond au client, TicketPro ne doit jamais le supprimer silencieusement. Le moteur doit :

- désactiver le voucher ;
- conserver l'objet externe ;
- écrire `state=cleanup-error` ;
- journaliser une erreur ;
- laisser TicketPro afficher une erreur de synchronisation, jamais `Supprimé`.

Après retrait manuel de l'autorisation externe, le scheduler doit reprendre le nettoyage au cycle suivant.

## Critère de sortie

Le Sprint 3 passe Hyper-V uniquement si les scénarios temps, quota, reconnexion, redémarrage RouterOS et erreur de nettoyage sont tous validés. Nova ne sera testé qu'ensuite, sur une fenêtre contrôlée et avec un voucher de laboratoire.
