/** Contact record as returned by the API (snake_case). */
export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  job_title: string;
  website: string;
  address: string;
  tags: string[];
  business_name: string;
  business_email: string;
  personal_email: string;
  poc_name: string;
  poc_role: string;
  poc_email: string;
  poc_phone: string;
  billing_name: string;
  billing_email: string;
  billing_address: string;
  gstin: string;
  pan: string;
  alternate_phones: string[];
  created_at: string;
  updated_at: string;
  comment_count?: number;
  last_interaction_at?: string | null;
  lead_status?: 'won' | 'open' | 'dropped' | null;
  lead_id?: string | null;
  projects?: { id: string; name: string; archived: boolean }[];
}

/** Editable fields: request key (camelCase) → response column. */
export const CONTACT_FIELDS = {
  name: 'name',
  email: 'email',
  company: 'company',
  phone: 'phone',
  jobTitle: 'job_title',
  website: 'website',
  address: 'address',
  businessName: 'business_name',
  businessEmail: 'business_email',
  personalEmail: 'personal_email',
  pocName: 'poc_name',
  pocRole: 'poc_role',
  pocEmail: 'poc_email',
  pocPhone: 'poc_phone',
  billingName: 'billing_name',
  billingEmail: 'billing_email',
  billingAddress: 'billing_address',
  gstin: 'gstin',
  pan: 'pan',
} as const;
export type ContactKey = keyof typeof CONTACT_FIELDS;
export type ContactForm = Record<ContactKey, string> & { tags: string; alternatePhones: string };

export function toForm(c?: Contact | null): ContactForm {
  const form = {} as ContactForm;
  for (const [k, col] of Object.entries(CONTACT_FIELDS)) (form as Record<string, string>)[k] = c ? String(c[col] ?? '') : '';
  form.tags = (c?.tags ?? []).join(', ');
  form.alternatePhones = (c?.alternate_phones ?? []).join(', ');
  return form;
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Request body; with `base`, only fields that changed are included. */
export function toBody(form: ContactForm, base?: ContactForm) {
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(CONTACT_FIELDS) as ContactKey[]) if (!base || form[k] !== base[k]) body[k] = form[k].trim();
  if (!base || form.tags !== base.tags) body.tags = list(form.tags);
  if (!base || form.alternatePhones !== base.alternatePhones) body.alternatePhones = list(form.alternatePhones);
  return body;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, ContactKey | 'tags'> = {
  name: 'name',
  fullname: 'name',
  contact: 'name',
  contactname: 'name',
  email: 'email',
  emailaddress: 'email',
  company: 'company',
  organisation: 'company',
  organization: 'company',
  phone: 'phone',
  mobile: 'phone',
  phonenumber: 'phone',
  jobtitle: 'jobTitle',
  title: 'jobTitle',
  role: 'jobTitle',
  website: 'website',
  url: 'website',
  address: 'address',
  tags: 'tags',
  gstin: 'gstin',
  gst: 'gstin',
  pan: 'pan',
  billingname: 'billingName',
  billingemail: 'billingEmail',
  billingaddress: 'billingAddress',
  businessname: 'businessName',
  businessemail: 'businessEmail',
  personalemail: 'personalEmail',
};

/** Maps CSV rows (first row = headers) to import records; unknown columns are ignored. */
export function csvToContacts(rows: string[][]) {
  const [header, ...body] = rows;
  if (!header) return { records: [], columns: [] as string[] };
  const keys = header.map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z]/g, '')]);
  const records = body.map((r) => {
    const rec: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const v = (r[i] ?? '').trim();
      rec[k] =
        k === 'tags'
          ? v
              .split(/[;,]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : v;
    });
    return rec;
  });
  return { records, columns: keys.filter(Boolean) as string[] };
}
