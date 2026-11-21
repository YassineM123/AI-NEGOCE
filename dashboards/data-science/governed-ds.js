(function(global){
"use strict";
/**
 * Data Science connected renderer. Figures are read from the SINGLE governed
 * backend snapshot via the parent portal; no locally generated models or CSV
 * are mixed into connected views. The parent keeps the bearer token.
 */
global.AINegoceGovernedDataScience=function(x,page,h){
 const ds=x.dataScience?.analysis;
 if(!ds||ds.version!=="ds-scoped-v1")return null;
 const {fAll,fKpis,table,fCard,fWarning,html,fmt,amt,lineChart}=h;
 const n=(v)=>v==null?"N/D":fmt(v);
 const tnd=(v)=>v==null?"N/D":amt(v);
 const warn=(v)=>fWarning(html(String(v)));
 const scope='<section data-ds-version="'+html(ds.version)+'" data-ds-snapshot="'+html(x.snapshotId)+
   '" class="callout">Data Science connecté au dataset BI / Agentic : '+
   html(ds.source)+' · snapshot '+html(x.snapshotId)+' · agence '+
   html(x.scope==="*"?"Toutes":x.scope.join(", "))+' · période '+
   html(x.bi.data.filters.from||"début")+' → '+html(x.bi.data.filters.to||"fin")+
   ' · référence '+html(ds.referenceDate)+
   '. Lecture seule ; toutes les prévisions et probabilités restent expérimentales.</section>';
 const portfolio=ds.portfolio,forecast=ds.forecast,inventory=ds.inventory,cash=ds.cash,scenarios=ds.scenarios;
 const metrics=fKpis([
  {icon:"wallet",label:"CA HT observé",value:tnd(x.bi.data.revenue),note:"Même somme que BI · TND"},
  {icon:"users",label:"Clients distincts",value:n(portfolio.customers),note:"Dans le périmètre"},
  {icon:"shield",label:"Inactivité constatée (90 j)",value:n(portfolio.inactive90),note:"Pas probabilité de churn"},
  {icon:"trend",label:"Prévision CA (pilote)",value:forecast.predictions.length?tnd(forecast.predictions[0].revenueTnd):"N/D",
   note:forecast.status==="backtested_pilot"?"Backtest admissible · non certifié":"Historique ou backtest insuffisant"},
  {icon:"database",label:"Modèles certifiés",value:"0",note:"Lecture seule · démo"},
 ]);
 const months=ds.trend.months;
 const history=fCard("CA mensuel · observations contrôlées",
  months.length?lineChart(months.map(v=>({m:v.month,ht:v.revenue}))):warn("Aucun mois de vente observé dans le périmètre."),
  {icon:"trend"});
 const trendTable=table([
  {label:"Mois",key:"month"},{label:"CA HT TND",format:r=>tnd(r.revenue)},
  {label:"Pièces",key:"documents"},{label:"Clôture",format:r=>r.closed?"Oui":"Non"},
 ],months);
 const customers=table([
  {label:"Client",key:"name"},{label:"CA HT TND",format:r=>tnd(r.revenueTnd)},
  {label:"Pièces",key:"documents"},
  {label:"Récence",format:r=>fmt(r.daysSinceLastPurchase)+" jours"},
  {label:"Segment",format:r=>html(r.segment==="inactive_90"?"Inactif ≥90 j":
    r.segment==="watch_30_89"?"À surveiller (30–89 j)":"Récent (0–29 j)")},
 ],portfolio.top);
 const clients=fCard("Portefeuille · activités observées",customers,{icon:"users"});
 const forecastInfo=fCard("Validation prévisionnelle CA",
  '<p>Modèle : '+html(forecast.modelVersion)+' · mois clos consécutifs : '+fmt(forecast.trainingMonths)+
  ' · entraîné jusqu’à '+html(forecast.trainedThrough||"N/D")+'</p>'+
  '<p>Backtest : '+(forecast.backtest.wape==null?"N/D":fmt(forecast.backtest.wape*100)+" % WAPE")+
  ' · '+fmt(forecast.backtest.holdoutMonths)+' mois testés.</p>'+
  (forecast.predictions.length?
    table([{label:"Mois",key:"month"},{label:"CA pilote",format:r=>tnd(r.revenueTnd)},
      {label:"Plage basse",format:r=>tnd(r.lowerTnd)},{label:"Plage haute",format:r=>tnd(r.upperTnd)}],
      forecast.predictions):
    warn("Aucune prévision diffusée : historique ou backtest insuffisant. Aucun résultat fabriqué."))+
  warn("Modèle expérimental : ni validation LAI ni droit d'action automatique."),
  {icon:"trend"});
 const seg=fCard("Récence des clients · constat, pas churn ML",
  table([{label:"Segment",key:"label"},{label:"Clients",key:"count"}],[
    {label:"Récent : 0–29 jours",count:portfolio.recent0to29},
    {label:"À surveiller : 30–89 jours",count:portfolio.watch30to89},
    {label:"Sans achat récent : ≥90 jours",count:portfolio.inactive90},
  ])+warn("Le seuil de 90 jours est une règle descriptive, pas un score de probabilité."),
  {icon:"shield"});
 const scenariosTable=fCard("Trois scénarios comparables · hypothèses",
  scenarios.status==="not_available"?warn("Pas de ventes sur cette période pour calculer les hypothèses."):
  table([{label:"Scénario",key:"label"},{label:"Hypothèse CA",format:r=>(r.variationPercent>0?"+":"")+fmt(r.variationPercent)+" %"},
    {label:"CA simulé HT",format:r=>tnd(r.revenueTnd)}],scenarios.options)+
    warn("Sensibilités arithmétiques sur les ventes de la période. Marge nette, trésorerie et faisabilité non calculées."),
  {icon:"trend"});
 const inventoryPanel=fCard("Stocks sous seuil · photographie actuelle",
  inventory.status==="not_available"?warn("Positions de stock fiables absentes dans ce dataset."):
    '<p>'+fmt(inventory.belowReorder)+' position(s) sous seuil sur '+
    fmt(inventory.positionsWithThreshold)+' position(s) avec seuil.</p>'+
    table([{label:"Référence",key:"reference"},{label:"Agence",key:"agency"},
      {label:"Disponible",key:"quantity"},{label:"Seuil",key:"reorderPoint"}],inventory.topBelow)+
    warn("Stock arrêté au "+ds.asOf+" ; le filtre historique ne reconstitue pas les stocks passés."),
  {icon:"box"});
 const cashPanel=fCard("Balance âgée · factures de la période",
  cash.status==="not_available"?warn("Créances détaillées absentes : impossible de mesurer les retards ou prévoir le cash."):
    '<p>Encours observé : '+tnd(cash.outstandingTnd)+' · échus : '+tnd(cash.overdueTnd)+
    ' · arrêté '+html(cash.asOf)+'</p>'+
    table([{label:"Âge",key:"label"},{label:"Montant TND",format:r=>tnd(r.amountTnd)},
      {label:"Pièces",key:"documents"}],cash.buckets)+
    warn("Factures émises durant la période, encours à la date d’arrêté ; ni solde bancaire ni cash-flow prévisionnel."),
  {icon:"wallet"});
 const sourcePanel=fCard("Contrôles de qualité des données",
  table([{label:"Contrôle",key:"label"},{label:"État",key:"state"}],[
    {label:"Ventes du périmètre",state:fmt(x.insights.summary.salesRows)+" ligne(s)"},
    {label:"Coûts non renseignés",state:fmt(x.insights.coverage.costMissingRows)+" ligne(s)"},
    {label:"Créances documentaires",state:cash.status==="not_available"?"Non disponibles":"Présentes, non rapprochées"},
    {label:"Stocks par référence",state:inventory.status==="not_available"?"Non disponibles":"Snapshot disponible"},
    {label:"Prévision CA",state:forecast.status},
    {label:"Modèle homologué production",state:"Aucun"},
  ])+warn(ds.warnings.join(" ")),{icon:"database"});
 const availability=(message)=>fCard("Capacité en attente de données ou de validation",
    warn(message)+"<p>La vue locale de simulation reste séparée du portail connecté. Aucun chiffre de simulation n'est mélangé au snapshot.</p>",
    {icon:"shield"});
 const grid=(...parts)=>'<div class="f-grid f-halves">'+parts.join("")+"</div>";
 let body=scope;
 if(page==="home")body+=grid(history,clients,seg,scenariosTable,sourcePanel);
 else if(page==="clients")body+=grid(clients,seg);
 else if(page==="churn")body+=grid(seg,clients);
 else if(page==="forecast")body+=grid(history,forecastInfo)+trendTable;
 else if(page==="inventory")body+=grid(inventoryPanel,sourcePanel);
 else if(page==="cash")body+=grid(cashPanel,sourcePanel);
 else if(page==="optim")body+=grid(scenariosTable,forecastInfo);
 else if(page==="quality"||page==="data")body+=grid(sourcePanel,history);
 else if(page==="models")body+=grid(forecastInfo,sourcePanel);
 else if(page==="affinity")body+=availability("Affinité et recommandations croisées : liens article–panier et catalogue vérifié nécessaires.");
 else if(page==="suppliers")body+=availability("Performance fournisseurs : commandes, dates promises et livraisons réelles manquantes.");
 else if(page==="production")body+=availability("Planification production : nomenclatures, capacités et besoins matières indisponibles.");
 else if(page==="impact")body+=availability("Impact observé : interventions historiques et groupes de comparaison absents.");
 else if(page==="tasks")body+=availability("Les tâches locales du prototype ne sont pas des missions Agentic persistantes ; utilisez le Command Center pour les missions réelles de démo.");
 else if(page==="assistant")body+=availability("L'assistant conversationnel gouverné se trouve dans Agentic Command Center ; pas de génération IA locale sur les données du client.");
 else body+=grid(history,sourcePanel);
 const heading=page==="forecast"?"Prévisions CA · modèle pilote":page==="churn"?
  "Risque d'inactivité · constats":page==="cash"?"Créances et retards documentés":
  page==="optim"?"Scénarios stratégiques chiffrés":page==="inventory"?
  "Stocks · seuils de réapprovisionnement":"Data Science · analyses gouvernées";
 return fAll(heading,"Même source BI / Agentic · filtres synchronisés · aucune écriture ERP",
   metrics,body,false);
};
})(window);
