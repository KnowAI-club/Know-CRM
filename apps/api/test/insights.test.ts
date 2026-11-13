import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAgent, setupSuite } from './helpers.js';
import { scoreTitle } from '../src/modules/search/routes.js';

setupSuite();

test('search scoring prefers exact and prefix matches', () => {
  assert.equal(scoreTitle('Acme', 'acme', ['acme']), 100);
  assert.equal(scoreTitle('Acme Labs', 'acme', ['acme']), 85);
  assert.equal(scoreTitle('Big Acme Labs', 'ac la', ['ac', 'la']), 70);
});

test('search, dashboard, today and reports respond with real data', async () => {
  const admin = await adminAgent();
  await admin.post('/api/leads').send({ name: 'Zara Searchable', email: 'zara@find.in', data: { company: 'Findable Co' } }).expect(201);
  const contact = (await admin.post('/api/contacts').send({ name: 'Rep Client', email: 'rep@c.in' }).expect(201)).body;
  await admin.post('/api/projects').send({ name: 'Findable rebuild', contactId: contact.id, value: 500000, stage: 'in_progress' }).expect(201);

  const search = (await admin.get('/api/search?q=findable').expect(200)).body;
  const keys = search.groups.map((g: any) => g.key);
  assert.ok(keys.includes('leads') && keys.includes('projects'), JSON.stringify(keys));

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const dash = (await admin.get(`/api/dashboard?from=${from}&to=${to}`).expect(200)).body;
  assert.ok(dash.metrics.activeProjects >= 1);
  assert.ok(dash.leads.active >= 1);
  assert.ok(dash.period.newLeads >= 1);
  assert.equal(typeof dash.metrics.unpaidBalance, 'number');

  const dayFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const today = (await admin.get(`/api/today?from=${dayFrom}&to=${dayTo}&toDay=${dayFrom.slice(0, 10)}`).expect(200)).body;
  assert.ok(today.leadsWithoutNextStep.some((l: any) => l.name === 'Zara Searchable'));

  const report = (await admin.get(`/api/reports/projects?from=${from}&to=${to}`).expect(200)).body;
  assert.ok(report.activeProjects >= 1);
  assert.ok(Array.isArray(report.stages));
  await admin.get(`/api/reports/projects.csv?from=${from}&to=${to}`).expect(200).expect('Content-Type', /text\/csv/);
  const facts = (await admin.get('/api/reports/lead-facts').expect(200)).body;
  assert.ok(facts.length >= 1);
  await admin.get('/api/reports/lead-stage-days').expect(200);
});
