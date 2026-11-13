import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app, adminAgent, agentFor, setupSuite } from './helpers.js';

setupSuite();

test('contracts publish immutably and clients sign once', async () => {
  const admin = await adminAgent();
  const contact = (await admin.post('/api/contacts').send({ name: 'Doc Client', email: 'doc@client.in' }).expect(201)).body;
  const project = (await admin.post('/api/projects').send({ name: 'Doc project', contactId: contact.id }).expect(201)).body;
  await admin
    .post(`/api/projects/${project.id}/client-access`)
    .send({ contactId: contact.id, name: 'Doc Client', email: 'portal@client.in', password: 'client-password-1' })
    .expect((r) => assert.ok([200, 201].includes(r.status), JSON.stringify(r.body)));
  const blocks = [
    { id: 'h1', type: 'heading', text: 'Agreement' },
    { id: 'svc', type: 'service', name: 'Website', quantity: 1, unitPrice: 5000000, currency: 'INR' },
  ];
  const doc = (await admin.post(`/api/projects/${project.id}/documents`).send({ title: 'Contract', kind: 'contract', blocks }).expect(201)).body;
  await admin.post(`/api/documents/${doc.id}/publish`).send({}).expect(400);
  await admin.patch(`/api/documents/${doc.id}`).send({ blocks: [...blocks, { id: 'sig', type: 'signature', label: 'Client signature' }] }).expect(200);
  const published = (await admin.post(`/api/documents/${doc.id}/publish`).send({}).expect(200)).body;
  assert.equal(published.content_hash.length, 64);
  await admin.patch(`/api/documents/${doc.id}`).send({ title: 'x' }).expect(409);

  const client = await agentFor('portal@client.in', 'client-password-1');
  const view = (await client.get(`/api/documents/${doc.id}`).expect(200)).body;
  assert.equal(view.created_by, undefined);
  const sign = { contentHash: view.content_hash, blockId: 'sig', typedName: 'Doc Client', consent: true };
  await client.post(`/api/documents/${doc.id}/sign`).send({ ...sign, contentHash: 'a'.repeat(64) }).expect(409);
  await client.post(`/api/documents/${doc.id}/sign`).send(sign).expect(201);
  await client.post(`/api/documents/${doc.id}/sign`).send(sign).expect(200);
  await client.post(`/api/documents/${doc.id}/sign`).send({ ...sign, typedName: 'Someone Else' }).expect(409);
  await admin.post(`/api/documents/${doc.id}/sign`).send(sign).expect(403);
});

test('lead form submissions create a lead, contact and intake project once', async () => {
  const admin = await adminAgent();
  const form = (
    await admin
      .post('/api/lead-forms')
      .send({ title: 'Website inquiry', fields: [
        { id: 'budget', label: 'Budget', type: 'select', required: true, options: ['Small', 'Large'] },
        { id: 'agree', label: 'I agree', type: 'checkbox', required: true },
      ] })
      .expect(201)
  ).body;
  await request(app).get(`/api/public/forms/${form.token}`).expect(404);
  await admin.post(`/api/lead-forms/${form.id}/publish`).send({}).expect(200);
  const pub = (await request(app).get(`/api/public/forms/${form.token}`).expect(200)).body;
  assert.equal(pub.version, 1);
  const body = { submissionId: randomUUID(), name: 'Form Person', email: 'form@person.in', answers: { budget: 'Large', agree: true }, version: 1 };
  await request(app).post(`/api/public/forms/${form.token}/submissions`).send({ ...body, answers: { budget: 'Huge', agree: true } }).expect(400);
  await request(app).post(`/api/public/forms/${form.token}/submissions`).send(body).expect(201);
  await request(app).post(`/api/public/forms/${form.token}/submissions`).send(body).expect(200);
  await request(app).post(`/api/public/forms/${form.token}/submissions`).send({ ...body, name: 'Changed' }).expect(409);
  await request(app)
    .post(`/api/public/forms/${form.token}/submissions`)
    .send({ ...body, submissionId: randomUUID(), website: 'bot' })
    .expect(202);
  const leads = (await admin.get('/api/leads').expect(200)).body.filter((l: any) => l.email === 'form@person.in');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].data.source, 'Lead form');
  const subs = (await admin.get(`/api/lead-forms/${form.id}/submissions`).expect(200)).body;
  assert.equal(subs.length, 1);
});

test('expenses validate categories and projects; only admins delete', async () => {
  const admin = await adminAgent();
  await admin.post('/api/expenses').send({ spentOn: '2026-05-01', vendor: 'Host', category: 'Software', amount: 100 }).expect(400);
  await admin.post('/api/expenses').send({ spentOn: '2026-05-01', vendor: 'Host', category: 'software', amount: 100, projectId: randomUUID() }).expect(400);
  const e = (await admin.post('/api/expenses').send({ spentOn: '2026-05-01', vendor: 'Host', category: 'software', amount: 129900 }).expect(201)).body;
  assert.equal(e.currency, 'INR');
  const updated = (await admin.patch(`/api/expenses/${e.id}`).send({ amount: 99900 }).expect(200)).body;
  assert.equal(updated.amount, 99900);
  await admin.delete(`/api/expenses/${e.id}`).expect(204);
});
