# Intégration ERP

Statut : **BLOCKED** pour l’ERP réel. Aucun schéma, endpoint, environnement test ni identifiant autorisé n’a été fourni.

L’actuelle source `server/data.ts` est un adaptateur local fictif et clairement étiqueté. Elle ne doit jamais être présentée comme AI-NEGOCE réel. L’adaptateur futur devra fournir fournisseurs, produits, commandes, factures, ventes, stocks et créances, ainsi qu’une création de facture idempotente après autorisation et revalidation. Aucun accès direct en écriture à une base ERP de production n’est autorisé.
