/**
 * Display names for HubSpot objects.
 *
 * The server returns raw object names (`contact`, `line_item`, or a custom
 * object type id) and stays language-agnostic; naming them is the admin's job.
 * An object with no entry here — a custom one — falls back to its own name
 * rather than showing nothing.
 */
const LABELS: Record<string, string> = {
  contact: "Contact",
  company: "Société",
  deal: "Transaction",
  ticket: "Ticket",
  product: "Produit",
  line_item: "Ligne de commande",
  quote: "Devis",
};

export function objectLabel(object: string): string {
  return LABELS[object] ?? object;
}
