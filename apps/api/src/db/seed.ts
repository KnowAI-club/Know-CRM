import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { one, query } from './pool.js';

export const DEMO_PASSWORD = 'demo-password-123';

/**
 * Seeds a demo workspace by driving the real API in-process, so every record
 * goes through the same validation and business rules as the app.
 */
export async function seedDemo() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  if (await one('SELECT 1 FROM users LIMIT 1')) {
    console.log('[seed] users already exist; skipping demo data.');
    return;
  }

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';

  async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: env.APP_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const post = <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b);
  const patch = <T = any>(p: string, b: unknown) => call<T>('PATCH', p, b);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const at = (offsetDays: number, hour: number) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  try {
    await post('/setup', { name: 'Alex Morgan', email: 'admin@example.com', password: DEMO_PASSWORD, workspaceName: 'Northwind Studio' });
    await patch('/settings', {
      billing: {
        address: '42 Residency Road, Bengaluru, Karnataka 560025',
        gstin: '29ABCDE1234F1Z5',
        email: 'accounts@example.com',
        bankAccountName: 'Northwind Studio',
        bankName: 'Example Bank',
        bankAccountNumber: '001234567890',
        bankIfsc: 'EXMP0001234',
        terms: 'Payment due within 15 days of the invoice date.',
      },
    });
    await post('/team', { name: 'Sam Patel', email: 'sam@example.com', password: DEMO_PASSWORD, role: 'sales' });
    await post('/team', { name: 'Jamie Chen', email: 'jamie@example.com', password: DEMO_PASSWORD, role: 'designer' });
    const team = await call<any[]>('GET', '/team');
    const samId = team.find((u) => u.email === 'sam@example.com')?.id;
    const admin = team.find((u) => u.email === 'admin@example.com');

    // Leads across the pipeline.
    const leadSeeds = [
      {
        name: 'Meera Iyer',
        email: 'meera@brightpath.example',
        company: 'BrightPath Learning',
        industry: 'Education',
        source: 'Website',
        stage: 'new',
        problem: 'Course enquiries are tracked in spreadsheets.',
      },
      {
        name: 'Rohan Mehta',
        email: 'rohan@urbanfresh.example',
        company: 'UrbanFresh Foods',
        industry: 'Retail',
        source: 'Referral',
        stage: 'discovery',
        problem: 'Order updates to clients are manual.',
      },
      {
        name: 'Ananya Rao',
        email: 'ananya@carewell.example',
        company: 'CareWell Clinics',
        industry: 'Healthcare',
        source: 'LinkedIn',
        stage: 'qualified',
        problem: 'Appointment follow-ups are missed.',
      },
      {
        name: 'Vikram Shah',
        email: 'vikram@stackline.example',
        company: 'Stackline Finance',
        industry: 'Finance',
        source: 'Word of mouth',
        stage: 'proposal',
        problem: 'Reporting takes three days a month.',
      },
      {
        name: 'Priya Nair',
        email: 'priya@loomhouse.example',
        company: 'Loomhouse Textiles',
        industry: 'Manufacturing',
        source: 'Instagram',
        stage: 'discovery',
        problem: 'No single view of distributor orders.',
      },
    ];
    const leads: any[] = [];
    for (const [i, s] of leadSeeds.entries()) {
      let lead = await post('/leads', {
        name: s.name,
        email: s.email,
        data: {
          company: s.company,
          industry: s.industry,
          source: s.source,
          problem: s.problem,
          phone: `+91 98450 1234${i}`,
          funnel: i % 2 ? 'outbound' : 'inbound',
          temperature: i === 4 ? 'cold' : 'warm',
          ownerId: i % 2 ? samId : admin.id,
          budget: ['₹2–5 lakh', '₹5–10 lakh', '₹10 lakh+'][i % 3],
          timeline: 'Next quarter',
        },
      });
      if (s.stage !== 'new') lead = await patch(`/leads/${lead.id}`, { version: lead.version, stage: s.stage });
      leads.push(lead);
    }
    await post(`/leads/${leads[0].id}/tasks`, { title: 'Call to understand current enquiry flow', dueDate: day(1), assigneeId: admin.id });
    await post(`/leads/${leads[2].id}/tasks`, {
      title: 'Share two relevant case studies',
      dueDate: day(2),
      assigneeId: samId,
      urgent: true,
    });
    await post(`/leads/${leads[2].id}/comments`, {
      body: `@[Sam Patel](user:${samId}) can you prepare the clinic case study before Thursday?`,
    });
    await post(`/leads/${leads[3].id}/notes`, { title: 'Pricing discussion', body: 'Prefers a phased rollout. Phase 1 budget approved.' });
    await post('/meetings', {
      title: 'Discovery call · UrbanFresh',
      leadId: leads[1].id,
      kind: 'video',
      startAt: at(1, 5),
      durationMinutes: 45,
      meetingUrl: 'https://meet.example.com/urbanfresh',
      notifications: [{ channel: 'in_app', minutes: 30 }],
    });

    // A lead parked in nurtures and one closed won.
    await post(`/leads/${leads[4].id}/action`, {
      action: 'exit',
      version: leads[4].version,
      exitStatus: 'on_hold',
      reason: 'Budget opens next quarter.',
      tags: ['not_ready'],
      resumeDate: day(60),
    });
    const wonLead = await post('/leads', {
      name: 'Kabir Singh',
      email: 'kabir@harborlogistics.example',
      data: {
        company: 'Harbor Logistics',
        industry: 'Technology',
        source: 'Referral',
        ownerId: admin.id,
        taxId: '27AAPFU0939F1ZV',
        billingName: 'Harbor Logistics Pvt Ltd',
      },
    });
    const won = await post(`/leads/${wonLead.id}/action`, { action: 'won', version: wonLead.version, dueDate: day(75), value: 120000000 });

    // Delivery project with milestones, tasks, invoice and payment.
    const projectId = won.project_id;
    await patch(`/projects/${projectId}`, { stage: 'in_progress', description: 'Customer portal and shipment tracking dashboard.' });
    const detail = await call('GET', `/projects/${projectId}`);
    await patch(`/projects/${projectId}/milestones/${detail.milestones[2].id}`, { status: 'done' });
    await patch(`/projects/${projectId}/milestones/${detail.milestones[3].id}`, { status: 'in_progress' });
    for (const [title, offset] of [
      ['Finalise dashboard wireframes', 3],
      ['Set up staging environment', 6],
      ['Client review of tracking flow', 12],
    ] as const)
      await post(`/projects/${projectId}/tasks`, { title, dueDate: day(offset), assigneeId: admin.id });
    const invoice = await post(`/projects/${projectId}/invoices`, {
      title: 'Phase 1 · Design and build',
      dueDate: day(10),
      lines: [
        { name: 'Discovery and UX design', quantity: 1, unitPrice: 30000000, taxable: true },
        { name: 'Portal development', quantity: 1, unitPrice: 60000000, taxable: true },
      ],
      taxComponents: [
        { label: 'CGST', rate: 900 },
        { label: 'SGST', rate: 900 },
      ],
      installments: [
        { label: 'Advance', amount: 53100000, dueDate: day(-5) },
        { label: 'On delivery', amount: 53100000, dueDate: day(40) },
      ],
    });
    await patch(`/invoices/${invoice.id}`, { status: 'sent' });
    await post(`/invoices/${invoice.id}/payments`, {
      amount: 53100000,
      method: 'bank_transfer',
      receivedDate: day(-2),
      reference: 'NEFT-284731',
      idempotencyKey: randomUUID(),
    });
    await post(`/projects/${projectId}/client-access`, { name: 'Kabir Singh', email: 'client@example.com', password: DEMO_PASSWORD });
    await post(`/projects/${projectId}/notes`, { body: 'Client prefers weekly updates on Fridays.', visibility: 'client' });
    await post(`/projects/${projectId}/documents`, {
      title: 'Phase 1 proposal',
      kind: 'proposal',
      blocks: [
        { id: 'intro', type: 'heading', text: 'Customer portal · Phase 1', level: 1 },
        { id: 'scope', type: 'text', text: 'We will design and build a customer portal with live shipment tracking.' },
        { id: 'design', type: 'service', name: 'Discovery and UX design', quantity: 1, unitPrice: 30000000, currency: 'INR' },
        { id: 'build', type: 'service', name: 'Portal development', quantity: 1, unitPrice: 60000000, currency: 'INR' },
      ],
    }).then((d) => post(`/documents/${d.id}/publish`));

    // A second, direct client project.
    const c2 = await post('/contacts', {
      name: 'Sara Thomas',
      email: 'sara@greenleaf.example',
      company: 'GreenLeaf Cafe',
      phone: '+91 99000 11223',
    });
    await post('/projects', { name: 'GreenLeaf menu website', contactId: c2.id, value: 18000000, stage: 'inquiry', dueDate: day(30) });

    // Booking page, lead form, nurture, finance.
    await post('/booking/types', {
      title: 'Intro call',
      description: 'A 30-minute call to understand your goals.',
      timezone: 'Asia/Kolkata',
      duration: 30,
      minimumNotice: 120,
      horizon: 30,
      availability: [1, 2, 3, 4, 5].map((d) => ({ day: d, start: '10:00', end: '17:00' })),
    });
    const form = await post('/lead-forms', {
      title: 'Project inquiry',
      description: 'Tell us about your project and we will get back within one working day.',
      fields: [
        { id: 'company', label: 'Company', type: 'text', required: false },
        { id: 'budget', label: 'Budget', type: 'select', required: true, options: ['Under ₹5 lakh', '₹5–10 lakh', 'Above ₹10 lakh'] },
        { id: 'details', label: 'What would you like to build?', type: 'textarea', required: true },
      ],
    });
    await post(`/lead-forms/${form.id}/publish`);
    const imported = await post('/nurtures/leads', {
      source: 'imported',
      leads: [
        { name: 'Neha Kapoor', company: 'Kapoor Interiors', email: 'neha@kapoorinteriors.example' },
        { name: 'Arjun Das', company: 'Das Motors', email: 'arjun@dasmotors.example' },
      ],
    });
    const sequences = await call<any[]>('GET', '/nurtures/sequences');
    if (sequences[0]) await post('/nurtures/assignments', { leadId: imported.ids[0], sequenceId: sequences[0].id });
    await post('/expenses', { spentOn: day(-3), vendor: 'Cloud hosting', category: 'software', amount: 450000, projectId });
    await post('/expenses', { spentOn: day(-10), vendor: 'Co-working space', category: 'rent', amount: 2500000 });
    await post('/services', {
      name: 'UX audit',
      description: 'Review of an existing product with prioritised fixes.',
      unitPrice: 7500000,
      unit: 'project',
    });
    await post('/services', {
      name: 'Monthly support',
      description: 'Bug fixes and small improvements.',
      unitPrice: 4000000,
      unit: 'month',
    });

    await query(`UPDATE notifications SET read_at = NULL`);
    console.log(`[seed] demo workspace ready. Sign in as admin@example.com / ${DEMO_PASSWORD}`);
    console.log(`[seed] also: sam@example.com (sales), jamie@example.com (designer), client@example.com (client portal)`);
  } finally {
    server.close();
  }
}
