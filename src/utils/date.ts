export function parseDate(input: string): Date | null {
  const trimmed = input.trim();

  if (trimmed.toLowerCase() === "today") {
    return new Date();
  }

  // No separator: YYYYMMDD only
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    const day = Number(trimmed.slice(6, 8));
    return validateAndCreateDate(year, month, day);
  }

  // With separator: detect format by position of 4-digit year
  const separatorMatch = trimmed.match(/^(\d{1,4})[\/\-\s](\d{1,2})[\/\-\s](\d{1,4})$/);
  if (separatorMatch) {
    const first = separatorMatch[1];
    const second = separatorMatch[2];
    const third = separatorMatch[3];

    if (!first || !second || !third) {
      return null;
    }

    // YYYY-MM-DD format (year first)
    if (first.length === 4) {
      return validateAndCreateDate(Number(first), Number(second), Number(third));
    }

    // DD-MM-YYYY format (year last)
    if (third.length === 4) {
      return validateAndCreateDate(Number(third), Number(second), Number(first));
    }
  }

  return null;
}

function validateAndCreateDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);

  // Validate the date components match (catches invalid dates like Feb 30)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateShort(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}
