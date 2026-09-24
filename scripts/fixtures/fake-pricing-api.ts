// A fake of Infracost's pricing API for the recorder (record 0105), so the
// fixtures of the cost estimate are what the real CLI printed against a
// price list that never changes, and no recording asks a service on the
// internet. The CLI validates its key with an empty query, then asks one
// GraphQL query per cost component with a product filter; the answer is one
// price per query. Under /refusing every query is refused like a bad key.
// The prices are a made-up list, small enough to check by hand: an instance
// hour of any type, and a unit of anything else.

export const FAKE_PRICING_PORT = 47831;
export const FAKE_PRICING_ENDPOINT = `http://127.0.0.1:${FAKE_PRICING_PORT}`;
export const REFUSING_PRICING_ENDPOINT = `${FAKE_PRICING_ENDPOINT}/refusing`;
export const FAKE_INSTANCE_HOUR_PRICE = "0.0416";
export const FAKE_UNIT_PRICE = "0.1";

interface Query {
  variables?: {
    productFilter?: { attributeFilters?: { key?: string; value?: string }[] };
  } | null;
}

function priceOf(query: Query): string {
  const filters = query.variables?.productFilter?.attributeFilters ?? [];
  const instance = filters.some((filter) => filter.key === "instanceType");
  return instance ? FAKE_INSTANCE_HOUR_PRICE : FAKE_UNIT_PRICE;
}

export function startFakePricingApi(): () => void {
  const server = Bun.serve({
    port: FAKE_PRICING_PORT,
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      if (url.pathname.startsWith("/refusing")) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
      }
      // The CLI reports its run to /event; nothing is kept of it.
      if (url.pathname.endsWith("/event")) return Response.json({});
      let queries: Query[] = [];
      try {
        const parsed: unknown = JSON.parse(body);
        queries = Array.isArray(parsed) ? (parsed as Query[]) : [parsed as Query];
      } catch {
        queries = [];
      }
      return Response.json(
        queries.map((query) => ({
          data: { products: [{ prices: [{ priceHash: "fake", USD: priceOf(query) }] }] },
        })),
      );
    },
  });
  return () => server.stop(true);
}
