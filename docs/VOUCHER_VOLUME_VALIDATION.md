# Validation des volumes Mo / Go

## Règles applicatives

- Mo = 1 048 576 octets ; Go = 1 024 Mo.
- Un champ vide signifie illimité. Zéro, une valeur négative ou non représentable sont refusés.
- RouterOS applique le volume sur chaque utilisateur Hotspot avec `limit-bytes-total`, cumulant envoi et réception. Le profil conserve le quota du plan dans une annotation non exécutée de `on-login` ; les scripts existants sont conservés.
- Chaque création / modification vérifie le quota relu. Une différence interdit la confirmation. Le chemin de génération tente de désactiver et déconnecter le voucher identifié comme appartenant au lot ; un échec reste signalé, jamais présenté comme une création réussie.
- La reprise après coupure utilise le volume enregistré à la création, pas le nouveau quota éventuel du plan. Les compteurs ne sont jamais remis à zéro par ces contrôles.
- Une synchronisation de lecture signale un conflit de quota ; elle ne répare pas silencieusement les utilisateurs existants.

## Migration des plans existants

1. Installer la version corrigée puis ouvrir les plans du routeur.
2. Vérifier chaque quota commercial, modifier puis enregistrer le plan pour écrire son annotation RouterOS.
3. Rafraîchir : le volume doit rester identique. Tester aussi le passage volontaire à illimité.
4. Auditer les tickets déjà émis : corriger un plan ne modifie pas automatiquement leurs quotas historiques. Si un quota a déjà été perdu avant cette correction, sa valeur ne peut pas être devinée : vérifier le contrat ou le snapshot du ticket avant toute réparation.

## Recette obligatoire sur MikroTik réel

Utiliser un appareil client distinct du poste d'administration. Ne jamais désactiver le bypass du poste de gestion pour ce test.

1. Créer un plan 10 Mo avec une validité supérieure à la durée du test, puis deux vouchers.
2. Vérifier dans WinBox que chaque utilisateur possède `limit-bytes-total=10485760`. Contrôler aussi un lot et un quota de 2 Go (`2147483648`).
3. Consommer une partie en téléchargement et une partie en envoi : le total des deux compteurs doit atteindre le quota et couper la session. Vérifier que le second voucher garde son propre quota.
4. Essayer une reconnexion par login, cookie et MAC-cookie : le voucher épuisé ne doit plus autoriser Internet.
5. Fermer TicketPro et répéter : l'application n'est pas responsable de la coupure ; RouterOS doit appliquer le quota de façon autonome.
6. Tester un redémarrage du routeur et la reprise d'une génération interrompue : vérifier les compteurs et l'absence de recréation des vouchers déjà confirmés.
7. Vérifier le volume affiché dans l'aperçu, le PDF et une réimpression depuis un autre poste ; modifier ensuite le plan sans changer le volume des tickets déjà émis.
8. Supprimer temporairement le quota d'un voucher de test via WinBox : TicketPro doit signaler un conflit, pas « Synchronisé ».

Vérifier également les IP bindings `bypassed`, les règles d'autorisation, le FastTrack et les exceptions réseau. Un client autorisé hors Hotspot peut contourner les limites Hotspot. La coupure réelle et la persistance des compteurs après reboot doivent être validées sur chaque configuration supportée ; les tests unitaires ne constituent pas cette preuve. Les limites réseau peuvent avoir une granularité de paquet et ne garantissent pas une frontière au dernier octet.

Documentation officielle : https://manual.mikrotik.com/docs/authentication-authorization-accounting/hotspot-captive-portal/
