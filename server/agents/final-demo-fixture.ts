/** One fixed, synthetic source for both API and PostgreSQL end-to-end recipes. */
import {defaultDataset,type Dataset} from "../services.js"
export const finalDemoScope={from:"2026-01-01",to:"2026-12-31"}
export const finalDemoDirectorObjective="Objectif CEO +15% de croissance CA sur un an : comparer agences, finance, trésorerie, stock, expansion et stratégie"
export const finalDemoSource="FINAL-DEMO-2026-FICTIF-V1"
export function finalDemoDataset():Dataset{
  const base=defaultDataset()
  return {
    ...base,
    metadata:{...base.metadata,source:finalDemoSource,asOf:"2026-10-20",lastUpdated:"2026-10-20T10:00:00.000Z"},
    sales:[
      {id:"F-SF-PREV",invoiceId:"F-SF-PREV",date:"2026-05-15",agency:"Sfax",
        customer:"Client Croissance",customerId:"CL-GROW",product:"SKU-A",
        productId:"SKU-A",quantity:10,family:"Consommables",representative:"QA",
        revenue:1000,cost:600,status:"posted"},
      {id:"F-SF-CUR",invoiceId:"F-SF-CUR",date:"2026-09-15",agency:"Sfax",
        customer:"Client Croissance",customerId:"CL-GROW",product:"SKU-A",
        productId:"SKU-A",quantity:15,family:"Consommables",representative:"QA",
        revenue:1500,cost:900,status:"posted"},
      {id:"F-TUN",invoiceId:"F-TUN",date:"2026-09-22",agency:"Tunis Centre",
        customer:"Client Tunis",customerId:"CL-TUN",product:"SKU-A",
        productId:"SKU-A",quantity:40,family:"Consommables",representative:"QA",
        revenue:4000,cost:2300,status:"posted"},
      {id:"F-SF-CANCELLED",invoiceId:"F-SF-CANCELLED",date:"2026-10-01",agency:"Sfax",
        customer:"Client Annulé",customerId:"CL-CANCEL",product:"SKU-A",
        family:"Consommables",representative:"QA",revenue:999999,cost:100,status:"cancelled"},
    ],
    receivables:[
      {invoiceId:"D-SF-LATE",agency:"Sfax",customer:"Client Croissance",date:"2026-05-15",
        dueDate:"2026-06-01",outstanding:9000},
      {invoiceId:"D-SF-FUTURE",agency:"Sfax",customer:"Client Croissance",date:"2026-10-10",
        dueDate:"2026-10-25",outstanding:1000},
      {invoiceId:"D-TUN",agency:"Tunis Centre",customer:"Client Tunis",date:"2026-09-22",
        dueDate:"2026-10-25",outstanding:500},
    ],
    inventory:[
      {reference:"SKU-A",product:"SKU-A",agency:"Sfax",quantity:0,reorderPoint:10,unitCost:60},
      {reference:"SKU-A",product:"SKU-A",agency:"Tunis Centre",quantity:30,reorderPoint:10,unitCost:60},
    ],
  }
}
