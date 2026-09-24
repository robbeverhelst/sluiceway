// The words of a cost estimate (record 0105): what a change does to the
// monthly bill, as a delta and never the bill, and an amount as a person reads
// one. Pure: plain data in, text out.

import type { CostEstimate } from "../core/cost.ts";

// `1,234.50`: two decimals and a thousands separator, whatever the currency.
// A fixed locale, so the same estimate gives the same bytes on every runner.
export function amount(value: number): string {
  return Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// `about **31.20 USD** more a month`, `less a month` for a change that saves,
// and `about the same cost a month` for one that changes nothing. Always
// "about": an estimate is a price list against a plan, not the bill.
export function costLine({ monthly, currency }: CostEstimate): string {
  if (monthly === 0) return "about the same cost a month";
  return `about **${amount(monthly)} ${currency}** ${monthly > 0 ? "more" : "less"} a month`;
}
