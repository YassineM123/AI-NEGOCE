
# AI-NÉGOCE — Audit ciblé Agentic / cahier des charges V1.0 (18-11-2026)

## Méthode
Comparaison avec le code de la branche feature/unified-ai-analytics-platform et les exigences
DIR-01..09, REV-01..40, FIN-01..60, SCA-01..72 et BSA-01..72 (244 capacités).
Les statuts ci-dessous décrivent **le périmètre démontré dans le code**, pas un pourcentage
d'homologation ERP. Les 244 capacités du catalogue sont une **cible**, pas des fonctions livrées.

## Déjà présent / consolidé
- JWT, profils, périmètres d'agences/organisations, refus inter-tenant.
- Revenue Growth : tendances simples, clients croissants/dormants/déclinants,
  priorité heuristique transparente, preuves et brouillons ; **pas de score de churn ML validé**.
- Financial Strategy : créances échues, simulations arithmétiques, références de pièces.
- Supply Chain : contrôles de stock sous seuil et coût indicatif sans fournisseur ni délai réel.
- Business Strategy : synthèse par agence, marge seulement si coût présent, scénarios arithmétiques.
- AI Director : délégation déterministe à 1–4 moteurs sans API externe, consolidation des constats.
- Missions JSONB multi-étapes, notifications, double validation, dossiers d'action
  exportables **sans write-back**.
- Agentic v2 ML : prévision expérimentale ridge tendance, validée localement sur
  historique clos; en l'absence d'historique le modèle abstient.
- Agentic v2.1 : contextes LLM sélectionnés/compacts, cap de tokens de sortie
  (320 spécialistes / 440 Director), 4 messages d'historique, 4 faits, preuves
  bornées, 40 appels quotidiens par utilisateur par défaut (ajustable
  via AGENTIC_DAILY_LLM_CALL_LIMIT=1..100), quota atomique dans PostgreSQL,
  réponses factuelles gratuites, journal de délégation et consommation réelle
  si le provider fournit les tokens. Les tokens estimés ne sont PAS une facturation.

## Écarts prioritaires — cahier vs implémentation
| Domaine / exigence | État vérifié | Manque / dépendance |
|---|---|---|
| DIR-01/02/03 | Partiel | Clarification d'objectif/budget, graphe de tâches indépendant, délégation typée selon contraintes, plafonds d'autonomie, reprise après échec |
| DIR-04/05 | Partiel | Dictionnaire de KPI certifié, unités et écarts entre hypothèses de spécialistes, drill-down de chaque chiffre et réconciliation officielle |
| DIR-06/07/08/09 | Partiel | Expiration/révocation des approbations, TTL/rétention du chat, alertes par politique configurable, suivi d'impact **observé** vs *estimé* |
| REV-05/07/08/14/19/25/28/33/40 | Manquant ou partiel | Profil client 360° complet, affinité/upsell, churn calibré, prix-marge validé, campagnes B2B, expérience contrôlée, boucle CRM |
| FIN-07/08/10/13/20/21/37/40/43/58/60 | Manquant ou partiel | Soldes bancaires, cash-in/out, BFR, prédiction de retard, anti-doublon paiements, rapprochement factures–commandes–réceptions, comptes et ROI/VAN, workflow ERP et mesure après action |
| SCA-01/07/08/10/14/19/21/25/31/70 | Manquant ou partiel | Réservé/transit, demande SKU×dépôt, prix fournisseurs et MOQ, couverture, transfert vs achat, OTIF, livraison, write-back gouverné |
| BSA-11/19/39/57/63/68/69/70/72 | Manquant ou partiel | Trois scénarios reproductibles, CAPEX et cash, faisabilité par ressources, plans propriétaires/jalons, réévaluation et suivi effectif |
| DATA / DS-02/04/06/09 | Partiel | Historique vérifié, modèles comparés au baseline, test chronologique indépendant, version promotion, monitoring dérive et rollback |
| SEC / L4 | Non implémenté | Outils transactionnels ERP validés, hash proposition, approbation à expiration, idempotence et réconciliation après timeout |
| EXPLOITATION | Partiel | Monitoring tokens/coûts mesurés, quotas par tenant, backlog, sauvegardes et restauration, SLA et charge vérifiée |

## Séquence réaliste alignée aux lots L0–L5
1. L0–L1 : confirmer adaptateur de lecture LAI, contrats documents, coûts, stocks,
   créances et autorisations; assurer parité chiffrée ERP/BI.
2. L2 : Director + REV en lecture, dossiers traçables, extraits utiles et priorités
   commerciales sans LLM lorsque le calcul suffit. Mesurer appels/tokens/latence.
3. L3 : Supply Chain stocks→achat avec scénarios faisables, coûts, délais,
   revalidation **avant** génération de brouillon; écriture seulement sur interface LAI validée.
4. L4 : cash/recouvrement, FIN/BSA et modèles DS homologués, pilotage des initiatives.
5. L5 : files et retries contrôlés, rétention, politiques alertes, budgets par org,
   observabilité et secours de modèle.

Règle fondamentale : ne jamais labelliser « implémenté » une fonction catalogue
sans données, accès et tests de recette démontrés. R01–R10 du cahier exigent
les validations et preuves métiers, pas uniquement des tests unitaires.
