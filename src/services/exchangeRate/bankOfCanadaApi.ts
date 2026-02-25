export interface ObservationRate {
  date: string;
  rate: number;
}

const VALET_BASE_URL =
  "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchRates(
  startDate: string,
  endDate: string,
  fetchFn: FetchFn = fetch
): Promise<ObservationRate[]> {
  const url = `${VALET_BASE_URL}?start_date=${startDate}&end_date=${endDate}`;
  const response = await fetchFn(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Bank of Canada API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    observations?: Array<{ d: string; FXUSDCAD: { v: string } }>;
  };
  const observations = data.observations ?? [];

  return observations.flatMap((obs) => {
    const rate = parseFloat(obs.FXUSDCAD.v);
    if (!Number.isFinite(rate) || rate <= 0) return [];
    return [{ date: obs.d, rate }];
  });
}
