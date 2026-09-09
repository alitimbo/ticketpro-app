# PR #6 — corrections de la revue

## Périmètre

- La page Routeurs affiche la copie SQLite avant la récupération cloud. Une panne VPS ne vide plus la liste. Après une récupération partiellement échouée, SQLite est relu pour respecter les suppressions déjà appliquées. Aucune sauvegarde automatique ne démarre si cette récupération a échoué.
- Le catalogue accepte un contexte explicite `purpose=report`. Le serveur contrôle `router.report.read` / `router.report.own`, l'organisation et l'accès au routeur. Le contexte par défaut reste `tickets` pour les anciens clients. Une valeur inconnue est refusée.
- La page Rapport ne publie le catalogue que si la session dispose d'une permission d'écriture correspondante. La lecture ne confère aucun nouveau droit d'écriture.
- La récupération combine les routeurs supprimés et les tombstones, y compris ceux sans ligne routeur. Les entrées identiques sont regroupées et les contrôles organisation/membre restent appliqués.

## Tests automatisés

```powershell
npm.cmd test
npm.cmd run type-check
npm.cmd run test:license-api
npm.cmd run build
git diff --check
```

Cas ajoutés : panne cloud, suppression partiellement appliquée, erreur SQLite, contexte rapport sans publication, tombstone orphelin, isolation des organisations, filtrage des rapports personnels et refus d'un routeur non attribué.

## Validation terrain avant diffusion

1. Sur deux PC du même compte, vérifier la présence du même routeur pilote.
2. Effectuer sa suppression via le parcours normal et ses contrôles de nettoyage, uniquement sur un routeur pilote autorisé à être retiré.
3. Revenir sur la page Routeurs de l'autre PC : après récupération, la copie disparaît et ne peut pas être restaurée par une sauvegarde obsolète.
4. Couper uniquement l'accès au VPS sur le PC de test, en conservant le LAN RouterOS. La liste locale reste visible ; ne pas interpréter l'absence de réponse cloud comme une suppression.
5. Vérifier que changer d'organisation ne laisse pas affichés les routeurs de l'organisation précédente et que le rafraîchissement ne ferme pas un formulaire ouvert.
6. Vérifier les rapports avec un administrateur, un agent et un invité. L'agent ne voit que ses tickets ; l'invité n'émet pas de publication de catalogue depuis cette page.

## Diffusion

Déployer l'API avant le desktop. Pas de migration de schéma ni de changement WireGuard/RouterOS dans ces corrections. La compilation web ne constitue pas un installateur Windows signé. Les tests automatisés ne remplacent pas la validation terrain ci-dessus.
