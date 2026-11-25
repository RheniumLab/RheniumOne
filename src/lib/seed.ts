/** Starting category lists from requirements §4.3. */
export const DEFAULT_CATEGORIES: { type: "company" | "project" | "income"; names: string[] }[] = [
  {
    type: "company",
    names: [
      "Rent", "Salaries & wages", "Electricity & utilities", "Internet & phone",
      "Software & subscriptions", "Office supplies", "Travel & conveyance", "Food & refreshments",
      "Repairs & maintenance", "Professional fees (CA, legal)", "Bank charges & interest",
      "Loan EMI", "Taxes & govt fees", "Insurance", "Marketing", "Training", "Miscellaneous",
    ],
  },
  {
    type: "project",
    names: [
      "Raw material & components", "Fabrication / job work", "Tools & consumables",
      "Labour / subcontract", "Freight & transport", "Site travel", "Food & stay at site",
      "Testing & certification", "Miscellaneous",
    ],
  },
  {
    type: "income",
    names: [
      "Client payment against invoice", "Client advance",
      "Other income (scrap sale, interest, etc.)", "Capital / loan received",
    ],
  },
];

export const PROJECT_STATUSES = ["Planned", "In progress", "On hold", "Completed", "Cancelled"];
