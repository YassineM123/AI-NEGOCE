# Aperçu anonymisé — Recouvrement et créances âgées

- Origine : `Modules > Recouvrement`, états Relevé quotidien, Documents non réglés, Soldes âgés, Risques âgés, Performance de recouvrement.
- Preuve : `dbo.descrip_menu` module `ENC`, `dbo.encentrecenc`, `dbo.View_echeancefact` et `dbo.View_JnlFactrepatie_ca_prep`.
- Extractions : `../EXTRACTIONS_BI/recouvrement/encaissements_mensuels_2026.csv` et `creances_agees_demo.csv`.
- Mesures : encaissements, solde, nombre de lignes, tranche d'âge.
- Visuel : cartes créances/encaissements, barres empilées par tranche, Pareto client.
- Statut : calcul SQL à rapprocher; date d'arrêté de la démonstration fixée au 20/10/2026.
