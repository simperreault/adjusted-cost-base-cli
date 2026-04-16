# Fetch Distribution Data from CDS

Fetch distribution data (phantom distributions and return of capital) for a Canadian security from the CDS CTBS portal and save it as a JSON file.

## Arguments

$ARGUMENTS - The security name to search for on CDS (e.g. "ISHARES CORE EQUITY ETF PORTFOLIO"). Optionally append a year to fetch from the archive (e.g. "ISHARES CORE EQUITY ETF PORTFOLIO 2024").

## Steps

### 1. Parse arguments

Extract the security name and optional year from the arguments. If a 4-digit year is provided at the end, use the CDS archive for that year. Otherwise, use the current CTBS portal.

### 2. Search for the security on CDS

**Current year (CTBS portal):**

Use bash to fetch the CTBS landing page and search for the security:

```bash
curl -s -L 'https://ctbsext.posttrade.cds.ca/ctbsExt/external-landing?lang=en' | grep -i -B10 -A15 "<SECURITY_NAME>"
```

From the HTML output, extract:
- The `taxFormId` value from: `<input type="hidden" name="taxFormId" value="T...">`
- The CUSIP from the `<td>` preceding the security name `<td>`
- Whether it's a revised filing (look for `<td>Y</td>` in the revised column)

Use `grep -o 'value="T[^"]*"'` to extract the taxFormId (macOS compatible).

**Archive (previous years):**

For previous years, fetch the archive page:
```bash
curl -s -L "https://services.cds.ca/taxforms/<YEAR>.html" | grep -i -B10 -A15 "<SECURITY_NAME>"
```

Archive filings are XLS files. Extract the XLS URL path and prepend `https://services.cds.ca/taxforms/` to get the full download URL.

If the security is not found, report this to the user and suggest they check the exact name on the CDS website at https://ctbsext.posttrade.cds.ca/ctbsExt/external-landing

### 3. Download the filing

**PDF (current year):**
```bash
curl -s -L -o /tmp/ctbs-distribution.pdf -X POST \
  -d 'taxFormId=<TAX_FORM_ID>' \
  'https://ctbsext.posttrade.cds.ca/ctbsExt/startDownloadFormExternal'
```

Verify it downloaded correctly: `file /tmp/ctbs-distribution.pdf` should show "PDF document".

**XLS (archive):**
```bash
curl -s -L -o /tmp/ctbs-distribution.xls '<FULL_XLS_URL>'
```

### 4. Extract distribution data

**For PDF files**, use `pdftotext -layout` for clean text extraction:
```bash
pdftotext -layout /tmp/ctbs-distribution.pdf -
```

If pdftotext is not available, use the Read tool to read the PDF directly.

**For XLS files**, use Python with xlrd:
```bash
python3 -c "
import xlrd
wb = xlrd.open_workbook('/tmp/ctbs-distribution.xls')
ws = wb.sheet_by_index(0)
for row in range(ws.nrows):
    vals = [str(ws.cell(row, col).value) for col in range(ws.ncols)]
    print(f'Row {row}: {\" | \".join(vals)}')
"
```

### 5. Identify ACB-relevant values

From the CDS T3/R16 form, extract these fields per distribution period:

| Field | Where to find it | ACB Impact |
|-------|-----------------|------------|
| Record Date | "Record Date" row | Determines which unitholders are affected |
| Total Non-Cash Distribution per unit | "Total Non Cash Distribution ($) Per Unit" row | **Increases ACB** (phantom/reinvested distribution) |
| Return of Capital per unit | Box 42/M row ("Return of Capital") | **Decreases ACB** |

**Security metadata** to extract:
- Trust Name, Ticker (SYMBOL), CUSIP, Currency, Taxation Year, Contact Name (issuer)

**Verification**: For each period, the tax breakdown rows should sum to the Total Distribution. Use this to confirm correct parsing.

### 6. Check for existing data

Check if `data/distributions/<TICKER>.json` already exists. If it does, read it and merge — add new distribution records by record date, avoiding duplicates.

### 7. Save as JSON

Save to `data/distributions/<TICKER>.json` following the schema in `src/services/distributions/types.ts` (SecurityDistributionData):

```json
{
  "ticker": "XEQT",
  "name": "iShares Core Equity ETF Portfolio",
  "cusip": "46436D108",
  "provider": "BlackRock Asset Management Canada Ltd.",
  "currency": "CAD",
  "lastUpdated": "2026-04-16",
  "notes": "Sourced from CDS CTBS T3/R16 filing",
  "distributions": [
    {
      "recordDate": "2025-03-26",
      "rocPerUnit": 0.00609,
      "phantomDistPerUnit": 0,
      "source": "CDS CTBS T3R16 TY2025"
    }
  ]
}
```

**Rules:**
- Include ALL distribution periods that have ROC > 0 or phantomDist > 0
- Use 5 decimal places for per-unit amounts
- `phantomDistPerUnit` comes from "Total Non Cash Distribution ($) Per Unit", NOT from the capital gains row
- Sort distributions by recordDate ascending
- Set `lastUpdated` to today's date

### 8. Report results

Display a summary:
- Security name, ticker, CUSIP
- Number of distribution periods found (and how many had non-zero ACB impact)
- Total ROC per unit for the tax year
- Total phantom distribution per unit for the tax year
- Net ACB impact per unit (phantom - ROC)
- File path where data was saved
