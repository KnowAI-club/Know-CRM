/**
 * Exact invoice math on integer minor units (paise/cents) using BigInt.
 * Rates are basis points (1800 = 18%). Discount comes off first, then the
 * service charge, then tax on taxable lines (after their share of discount).
 */
export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  taxable?: boolean;
}
export interface TaxComponentInput {
  label: string;
  rate: number;
}
export interface InvoiceInput {
  lines: InvoiceLineInput[];
  discountType: 'none' | 'fixed' | 'percent';
  discountValue: number;
  serviceChargeRate: number;
  taxRate: number;
  taxComponents?: TaxComponentInput[];
}
export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  serviceChargeAmount: number;
  taxAmount: number;
  total: number;
  taxComponents: { label: string; rate: number; amount: number }[];
}

const divide = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n);

export function lineAmount(line: InvoiceLineInput) {
  return Number(divide(BigInt(Math.round(line.quantity * 100)) * BigInt(Math.round(line.unitPrice)), 100n));
}

export function calculateTotals(input: InvoiceInput): InvoiceTotals {
  const amounts = input.lines.map((l) => BigInt(lineAmount(l)));
  const subtotal = amounts.reduce((a, b) => a + b, 0n);
  const taxableSubtotal = input.lines.reduce((a, l, i) => (l.taxable ? a + amounts[i]! : a), 0n);
  let discount =
    input.discountType === 'fixed'
      ? BigInt(Math.round(input.discountValue))
      : input.discountType === 'percent'
        ? divide(subtotal * BigInt(Math.round(input.discountValue)), 10000n)
        : 0n;
  if (discount > subtotal) discount = subtotal;
  const taxableDiscount = subtotal ? divide(discount * taxableSubtotal, subtotal) : 0n;
  const discounted = subtotal - discount;
  const serviceCharge = divide(discounted * BigInt(Math.round(input.serviceChargeRate)), 10000n);
  const taxBase = taxableSubtotal - taxableDiscount;
  const components = (input.taxComponents ?? []).map((c) => ({
    label: c.label,
    rate: c.rate,
    amount: Number(divide(taxBase * BigInt(Math.round(c.rate)), 10000n)),
  }));
  const tax = components.length
    ? BigInt(components.reduce((a, c) => a + c.amount, 0))
    : divide(taxBase * BigInt(Math.round(input.taxRate)), 10000n);
  return {
    subtotal: Number(subtotal),
    discountAmount: Number(discount),
    serviceChargeAmount: Number(serviceCharge),
    taxAmount: Number(tax),
    total: Number(discounted + serviceCharge + tax),
    taxComponents: components,
  };
}

export const percentLabel = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}
function words(n: number, indian: boolean): string {
  if (n === 0) return 'Zero';
  const scales: [number, string][] = indian
    ? [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]
    : [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const out: string[] = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      out.push(`${words(Math.floor(n / size), indian)} ${name}`);
      n %= size;
    }
  }
  if (n) out.push(below1000(n));
  return out.join(' ');
}

/** "INR One Lakh Twenty Thousand and Fifty Paise Only" */
export function amountInWords(minor: number, currency: string) {
  const major = Math.floor(minor / 100);
  const fraction = minor % 100;
  const indian = currency === 'INR';
  const unit = indian ? 'Paise' : 'Cents';
  return `${currency} ${words(major, indian)}${fraction ? ` and ${words(fraction, indian)} ${unit}` : ''} Only`;
}

const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinDetails(gstin: string) {
  if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin)) return null;
  const code = gstin.slice(0, 2);
  const state = GST_STATES[code];
  return { pan: gstin.slice(2, 12), state: state ? `${state} (${code})` : null };
}
