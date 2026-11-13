'use client';
import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorBox, Field, Spinner } from '@/components/ui';
import { PublicFrame } from '@/components/growth/PublicFrame';
import { FormFieldInput } from '@/components/growth/FormFieldInput';
import { fieldErrors, newId } from '@/components/growth/util';
import type { FormField } from '@/components/growth/types';

interface PublicForm {
  title: string;
  description: string;
  fields: FormField[];
  version: number;
  workspace: string;
}

export default function PublicLeadFormPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error, loading, reload } = useLoad((s) => get<PublicForm>(`/public/forms/${token}`, s), [token]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);

  if (loading && !data)
    return (
      <PublicFrame>
        <Spinner />
      </PublicFrame>
    );
  if (error || !data)
    return (
      <PublicFrame>
        <div className="card p-8 text-center">
          <p className="font-semibold">This form is not available</p>
          <p className="mt-1 text-sm text-mute">It may have been closed. Please contact the person who shared it.</p>
        </div>
      </PublicFrame>
    );

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email.';
    for (const f of data.fields) {
      const v = answers[f.id];
      if (f.type === 'checkbox') {
        if (f.required && v !== true) errs[`answers.${f.id}`] = 'Please tick this box.';
        continue;
      }
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) {
        if (f.required) errs[`answers.${f.id}`] = 'This question is required.';
      } else if (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(s)) errs[`answers.${f.id}`] = 'Enter a valid email.';
      else if (f.type === 'phone' && !/^[+()\d\s.-]{3,40}$/.test(s)) errs[`answers.${f.id}`] = 'Enter a valid phone number.';
    }
    return errs;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    const clean: Record<string, string | boolean> = {};
    for (const f of data.fields) {
      const v = answers[f.id];
      clean[f.id] = f.type === 'checkbox' ? v === true : typeof v === 'string' ? v.trim() : '';
    }
    const body = { name: name.trim(), email: email.trim(), answers: clean, version: data.version };
    const key = JSON.stringify(body);
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setSaving(true);
    try {
      await post(`/public/forms/${token}/submissions`, { ...body, submissionId: attempt.current.id, website });
      setSent(true);
    } catch (err) {
      setErrors(fieldErrors(err));
      if (err instanceof ApiError && err.status === 409 && /changed/i.test(err.message)) {
        setFormError('This form was just updated. We reloaded it — please check your answers and submit again.');
        attempt.current = null;
        await reload();
      } else setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (sent)
    return (
      <PublicFrame workspace={data.workspace}>
        <div className="card p-8 text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-acc-soft text-acc">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">Thank you, {name.trim().split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-mute">We received your details and will be in touch soon.</p>
        </div>
      </PublicFrame>
    );

  return (
    <PublicFrame workspace={data.workspace}>
      <form onSubmit={submit} noValidate className="card p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{data.title}</h1>
        {data.description && <p className="mt-2 text-sm whitespace-pre-line text-mute">{data.description}</p>}
        <div className="mt-6 space-y-4">
          {formError && <ErrorBox error={formError} />}
          <Field label="Your name" required error={errors.name}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} />
          </Field>
          <Field label="Email" required error={errors.email}>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              maxLength={254}
            />
          </Field>
          {data.fields.map((f) =>
            f.type === 'checkbox' ? (
              <div key={f.id}>
                <FormFieldInput field={f} value={answers[f.id]} onChange={(v) => setAnswers({ ...answers, [f.id]: v })} />
                {errors[`answers.${f.id}`] && <p className="mt-1 text-xs text-danger">{errors[`answers.${f.id}`]}</p>}
              </div>
            ) : (
              <div key={f.id}>
                <label htmlFor={`q-${f.id}`} className="label">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <FormFieldInput field={f} value={answers[f.id]} onChange={(v) => setAnswers({ ...answers, [f.id]: v })} />
                {errors[`answers.${f.id}`] && <p className="mt-1 text-xs text-danger">{errors[`answers.${f.id}`]}</p>}
              </div>
            ),
          )}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            aria-hidden
          />
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="submit" loading={saving}>
            Send
          </Button>
        </div>
      </form>
    </PublicFrame>
  );
}
