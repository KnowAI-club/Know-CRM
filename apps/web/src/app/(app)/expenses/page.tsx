'use client';
import { useMemo, useState } from 'react';
import { Download, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@know-crm/shared';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Menu,
  Modal,
  MoneyInput,
  PageHeader,
  Spinner,
  Stat,
  useConfirm,
  useToast,
} from '@/components/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, money, today } from '@/lib/format';
import { fieldErrors } from '@/components/money/util';

interface Expense {
  id: string;
  spent_on: string;
  vendor: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  project_id: string | null;
  project_name: string | null;
  created_by_name: string | null;
}
interface ProjectOption {
  id: string;
  name: string;
}

const monthStart = () => `${today().slice(0, 8)}01`;

export default function ExpensesPage() {
  const { currency, isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const expenses = useLoad((s) => get<Expense[]>('/expenses', s), []);
  const projects = useLoad((s) => get<ProjectOption[]>('/projects', s), []);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  const shown = useMemo(
    () =>
      (expenses.data ?? []).filter(
        (e) =>
          (!from || e.spent_on >= from) &&
          (!to || e.spent_on <= to) &&
          (!category || e.category === category) &&
          (!projectId || (projectId === 'none' ? !e.project_id : e.project_id === projectId)),
      ),
    [expenses.data, from, to, category, projectId],
  );
  const total = shown.reduce((a, e) => a + e.amount, 0);
  const thisMonth = (expenses.data ?? []).filter((e) => e.spent_on >= monthStart()).reduce((a, e) => a + e.amount, 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of shown) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [shown]);
  const filtered = from || to || category || projectId;

  const remove = async (e: Expense) => {
    if (
      !(await confirm({
        title: 'Delete this expense?',
        description: `${e.vendor} · ${money(e.amount, e.currency)}`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/expenses/${e.id}`);
      expenses.setData((list) => list?.filter((x) => x.id !== e.id));
      toast.success('Expense deleted.');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Expenses"
        description="Track what the business spends, optionally against a project."
        actions={
          <>
            <Button variant="secondary" onClick={() => window.open('/api/expenses/export.csv', '_blank')}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> Add expense
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={filtered ? 'Filtered total' : 'All time'}
          value={money(total, currency)}
          hint={`${shown.length} expense${shown.length === 1 ? '' : 's'}`}
        />
        <Stat label="This month" value={money(thisMonth, currency)} />
        <div className="card col-span-2 p-4 lg:col-span-1">
          <p className="text-xs font-medium text-mute">Top categories</p>
          {byCategory.length === 0 ? (
            <p className="mt-2 text-sm text-faint">Nothing yet</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {byCategory.slice(0, 3).map(([k, v]) => (
                <li key={k} className="text-xs">
                  <div className="flex justify-between">
                    <span>{EXPENSE_CATEGORIES[k] ?? k}</span>
                    <span className="tabular-nums text-mute">{money(v, currency)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-acc" style={{ width: `${(v / (byCategory[0]![1] || 1)) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Card bodyClassName="p-0">
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Category">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All</option>
              <option value="none">No project (overheads)</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              disabled={!filtered}
              onClick={() => {
                setFrom('');
                setTo('');
                setCategory('');
                setProjectId('');
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
        {expenses.error ? (
          <div className="p-4">
            <ErrorBox error={expenses.error} retry={expenses.reload} />
          </div>
        ) : !expenses.data ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty
            icon={<Receipt className="h-5 w-5" />}
            title={expenses.data.length ? 'No expenses match' : 'No expenses yet'}
            description={expenses.data.length ? 'Adjust the filters.' : 'Log software, rent, contractors and other spend.'}
            action={!expenses.data.length && <Button onClick={() => setEditing('new')}>Add expense</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Project</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{date(e.spent_on)}</td>
                    <td>
                      <p className="font-medium">{e.vendor}</p>
                      {e.description && <p className="max-w-72 truncate text-xs text-mute">{e.description}</p>}
                    </td>
                    <td className="text-mute">{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                    <td className="text-mute">{e.project_name ?? '—'}</td>
                    <td className="text-right font-medium tabular-nums">{money(e.amount, e.currency)}</td>
                    <td className="w-10 text-right">
                      <Menu
                        trigger={(open) => (
                          <Button size="icon" variant="ghost" aria-label="Expense actions" onClick={open}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        )}
                        items={[
                          {
                            label: 'Edit',
                            icon: <Pencil className="h-4 w-4" />,
                            onSelect: () => setEditing(e),
                          },
                          ...(isAdmin
                            ? [
                                {
                                  label: 'Delete',
                                  icon: <Trash2 className="h-4 w-4" />,
                                  danger: true,
                                  onSelect: () => remove(e),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-3 py-2.5 text-right text-sm text-mute">
                    Total
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(total, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <ExpenseModal
          expense={editing === 'new' ? null : editing}
          projects={projects.data ?? []}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            expenses.setData((list) => {
              const rest = (list ?? []).filter((x) => x.id !== saved.id);
              return [saved, ...rest].sort((a, b) => b.spent_on.localeCompare(a.spent_on));
            });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ExpenseModal({
  expense,
  projects,
  currency,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  projects: ProjectOption[];
  currency: string;
  onClose: () => void;
  onSaved: (e: Expense) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    spentOn: expense?.spent_on ?? today(),
    vendor: expense?.vendor ?? '',
    description: expense?.description ?? '',
    category: expense?.category ?? '',
    projectId: expense?.project_id ?? '',
  });
  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.spentOn) errs.spentOn = 'Choose a date.';
    if (!form.vendor.trim()) errs.vendor = 'Add the vendor.';
    if (!form.category) errs.category = 'Choose a category.';
    if (!amount || amount <= 0) errs.amount = 'Enter an amount.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = { ...form, vendor: form.vendor.trim(), amount };
      const saved = expense ? await patch<Expense>(`/expenses/${expense.id}`, body) : await post<Expense>('/expenses', body);
      toast.success(expense ? 'Expense updated.' : 'Expense added.');
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" required error={errors.vendor} className="sm:col-span-2">
          <input className="input" value={form.vendor} onChange={set('vendor')} maxLength={200} />
        </Field>
        <Field label="Date" required error={errors.spentOn}>
          <input type="date" className="input" value={form.spentOn} onChange={set('spentOn')} />
        </Field>
        <Field label="Amount" required error={errors.amount}>
          <MoneyInput value={amount} currency={currency} onChange={setAmount} />
        </Field>
        <Field label="Category" required error={errors.category}>
          <select className="input" value={form.category} onChange={set('category')}>
            <option value="">Choose…</option>
            {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project" hint="Optional" error={errors.projectId}>
          <select className="input" value={form.projectId} onChange={set('projectId')}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2" error={errors.description}>
          <textarea className="input" rows={2} value={form.description} onChange={set('description')} maxLength={2000} />
        </Field>
      </form>
    </Modal>
  );
}
