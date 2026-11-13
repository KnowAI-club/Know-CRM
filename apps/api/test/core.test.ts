import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, adminAgent, agentFor, setupSuite } from './helpers.js';

setupSuite();

test('setup creates the first admin and rejects a second setup', async () => {
  const admin = await adminAgent();
  const status = await admin.get('/api/auth/status').expect(200);
  assert.equal(status.body.user.role, 'admin');
  assert.equal(status.body.workspace.currency, 'INR');
  await request(app)
    .post('/api/setup')
    .send({ name: 'X', email: 'x@test.local', password: 'another-password-1', workspaceName: 'Y' })
    .expect(409);
});

test('protected endpoints require a session', async () => {
  await request(app).get('/api/contacts').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong-password' }).expect(401);
});

test('team members cannot change contact email; GSTIN derives PAN', async () => {
  const admin = await adminAgent();
  await admin
    .post('/api/team')
    .send({ name: 'Sam Sales', email: 'sam@test.local', password: 'sales-password-123', role: 'sales' })
    .expect(201);
  const contact = await admin.post('/api/contacts').send({ name: 'Asha Rao', email: 'asha@acme.in', gstin: '27AAPFU0939F1ZV' }).expect(201);
  assert.equal(contact.body.pan, 'AAPFU0939F');
  assert.deepEqual(contact.body.tags, ['Manual']);
  const sam = await agentFor('sam@test.local', 'sales-password-123');
  await sam.patch(`/api/contacts/${contact.body.id}`).send({ email: 'new@acme.in' }).expect(403);
  await sam.patch(`/api/contacts/${contact.body.id}`).send({ company: 'Acme' }).expect(200);
  await sam.delete(`/api/contacts/${contact.body.id}`).expect(403);
});

test('projects get default milestones, start date and activity on stage change', async () => {
  const admin = await adminAgent();
  const contact = await admin.post('/api/contacts').send({ name: 'Ravi', email: 'ravi@b.in' }).expect(201);
  const project = await admin.post('/api/projects').send({ name: 'Website', contactId: contact.body.id, value: 1500000 }).expect(201);
  assert.equal(project.body.start_date, null);
  const moved = await admin.patch(`/api/projects/${project.body.id}`).send({ stage: 'in_progress' }).expect(200);
  assert.ok(moved.body.start_date);
  const detail = await admin.get(`/api/projects/${project.body.id}`).expect(200);
  assert.equal(detail.body.milestones.length, 8);
  assert.ok(detail.body.activity.some((a: any) => a.description === 'Stage changed to In progress'));

  // Completing a later milestone completes earlier ones.
  const third = detail.body.milestones[2];
  const ms = await admin.patch(`/api/projects/${project.body.id}/milestones/${third.id}`).send({ status: 'done' }).expect(200);
  assert.deepEqual(
    ms.body.slice(0, 3).map((m: any) => m.status),
    ['done', 'done', 'done'],
  );
});

test('invoice lifecycle: GST totals, instalments, payments, void rules', async () => {
  const admin = await adminAgent();
  const contact = await admin.post('/api/contacts').send({ name: 'Inv Client', email: 'inv@c.in' }).expect(201);
  const project = await admin.post('/api/projects').send({ name: 'Billing', contactId: contact.body.id }).expect(201);
  const inv = await admin
    .post(`/api/projects/${project.body.id}/invoices`)
    .send({
      title: 'Phase 1',
      dueDate: '2026-01-01',
      lines: [{ name: 'Design', quantity: 1, unitPrice: 10000000, taxable: true }],
      taxComponents: [
        { label: 'CGST', rate: 900 },
        { label: 'SGST', rate: 900 },
      ],
      installments: [
        { label: 'Advance', amount: 5900000, dueDate: '2026-01-01' },
        { label: 'Balance', amount: 5900000, dueDate: '2099-01-01' },
      ],
    })
    .expect(201);
  assert.equal(inv.body.total, 11800000);
  assert.equal(inv.body.number, 'INV-0001');
  await admin
    .post(`/api/invoices/${inv.body.id}/payments`)
    .send({ amount: 100, method: 'upi', receivedDate: '2026-01-02', idempotencyKey: 'early-key-1' })
    .expect(409);
  const sent = await admin.patch(`/api/invoices/${inv.body.id}`).send({ status: 'sent' }).expect(200);
  assert.equal(sent.body.status, 'overdue');
  await admin.patch(`/api/invoices/${inv.body.id}`).send({ title: 'Changed' }).expect(409);
  const paid = await admin
    .post(`/api/invoices/${inv.body.id}/payments`)
    .send({ amount: 5900000, method: 'upi', receivedDate: '2026-01-02', idempotencyKey: 'pay-key-0001' })
    .expect(201);
  assert.equal(paid.body.status, 'partial');
  assert.deepEqual(
    paid.body.installments.map((i: any) => i.status),
    ['paid', 'upcoming'],
  );
  await admin.post(`/api/invoices/${inv.body.id}/void`).send({ reason: 'test' }).expect(409);
  const payment = paid.body.payments[0];
  await admin.post(`/api/payments/${payment.id}/reverse`).send({ reason: 'bounced' }).expect(200);
  const voided = await admin.post(`/api/invoices/${inv.body.id}/void`).send({ reason: 'test' }).expect(200);
  assert.equal(voided.body.status, 'void');
});
