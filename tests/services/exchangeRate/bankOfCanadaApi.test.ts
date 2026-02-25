import { describe, expect, test } from "bun:test";
import { fetchRates } from "../../../src/services/exchangeRate/bankOfCanadaApi.ts";

function mockFetch(body: unknown, status = 200, statusText = "OK") {
  return async () => new Response(JSON.stringify(body), { status, statusText });
}

describe("fetchRates", () => {
  test("parses Valet API response correctly", async () => {
    const rates = await fetchRates(
      "2025-01-13",
      "2025-01-15",
      mockFetch({
        observations: [
          { d: "2025-01-13", FXUSDCAD: { v: "1.4350" } },
          { d: "2025-01-14", FXUSDCAD: { v: "1.4414" } },
          { d: "2025-01-15", FXUSDCAD: { v: "1.4390" } },
        ],
      })
    );

    expect(rates).toEqual([
      { date: "2025-01-13", rate: 1.435 },
      { date: "2025-01-14", rate: 1.4414 },
      { date: "2025-01-15", rate: 1.439 },
    ]);
  });

  test("returns empty array for no observations", async () => {
    const rates = await fetchRates(
      "2025-01-13",
      "2025-01-15",
      mockFetch({ observations: [] })
    );
    expect(rates).toEqual([]);
  });

  test("throws on non-OK response", async () => {
    await expect(
      fetchRates("2025-01-13", "2025-01-15", mockFetch({}, 404, "Not Found"))
    ).rejects.toThrow("Bank of Canada API error: 404 Not Found");
  });

  test("constructs correct URL with date range", async () => {
    let capturedUrl = "";
    const spy = async (input: string | URL | Request) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ observations: [] }));
    };

    await fetchRates("2025-01-06", "2025-01-15", spy);

    expect(capturedUrl).toBe(
      "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2025-01-06&end_date=2025-01-15"
    );
  });
});
