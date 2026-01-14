import { describe, expect, it } from "bun:test";
import { parseDate, formatDate } from "../../src/utils/date";

describe("parseDate", () => {
  describe("today keyword", () => {
    it("parses 'today' as current date", () => {
      const result = parseDate("today");
      expect(result).not.toBeNull();
      const now = new Date();
      expect(result!.getFullYear()).toBe(now.getFullYear());
      expect(result!.getMonth()).toBe(now.getMonth());
      expect(result!.getDate()).toBe(now.getDate());
    });

    it("parses 'TODAY' case-insensitively", () => {
      const result = parseDate("TODAY");
      expect(result).not.toBeNull();
    });

    it("handles whitespace around 'today'", () => {
      const result = parseDate("  today  ");
      expect(result).not.toBeNull();
    });
  });

  describe("YYYYMMDD format (no separator)", () => {
    it("parses 20260201 as Feb 1, 2026", () => {
      const result = parseDate("20260201");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1); // 0-indexed
      expect(result!.getDate()).toBe(1);
    });

    it("parses 20251225 as Dec 25, 2025", () => {
      const result = parseDate("20251225");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(11);
      expect(result!.getDate()).toBe(25);
    });

    it("rejects invalid date like Feb 30", () => {
      const result = parseDate("20260230");
      expect(result).toBeNull();
    });
  });

  describe("YYYY-MM-DD format (dash separator)", () => {
    it("parses 2026-02-01", () => {
      const result = parseDate("2026-02-01");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });

    it("parses single-digit month and day: 2026-2-1", () => {
      const result = parseDate("2026-2-1");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("YYYY/MM/DD format (slash separator)", () => {
    it("parses 2026/02/01", () => {
      const result = parseDate("2026/02/01");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });

    it("parses single-digit: 2026/2/1", () => {
      const result = parseDate("2026/2/1");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("YYYY MM DD format (space separator)", () => {
    it("parses 2026 02 01", () => {
      const result = parseDate("2026 02 01");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("DD-MM-YYYY format (day first, dash separator)", () => {
    it("parses 01-02-2026 as Feb 1, 2026", () => {
      const result = parseDate("01-02-2026");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });

    it("parses single-digit: 1-2-2026", () => {
      const result = parseDate("1-2-2026");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("DD/MM/YYYY format (day first, slash separator)", () => {
    it("parses 01/02/2026 as Feb 1, 2026", () => {
      const result = parseDate("01/02/2026");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("DD MM YYYY format (day first, space separator)", () => {
    it("parses 01 02 2026 as Feb 1, 2026", () => {
      const result = parseDate("01 02 2026");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe("invalid inputs", () => {
    it("returns null for empty string", () => {
      expect(parseDate("")).toBeNull();
    });

    it("returns null for random text", () => {
      expect(parseDate("not a date")).toBeNull();
    });

    it("returns null for partial date", () => {
      expect(parseDate("2026-02")).toBeNull();
    });

    it("returns null for invalid month", () => {
      expect(parseDate("2026-13-01")).toBeNull();
    });

    it("returns null for invalid day", () => {
      expect(parseDate("2026-02-30")).toBeNull();
    });
  });
});

describe("formatDate", () => {
  it("formats date as YYYY-MM-DD", () => {
    const date = new Date(2026, 1, 1); // Feb 1, 2026
    expect(formatDate(date)).toBe("2026-02-01");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDate(date)).toBe("2026-01-05");
  });
});
