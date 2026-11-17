import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Label, TextField } from '@heroui/react';
import { ApiError, errorText } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import BrandMark from '../ui/BrandMark';

export default function LoginPage() {
  const { login } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <div className="login-page">
      <section className="login-panel" aria-label={t('app.name')}>
        <header className="login-brand">
          <BrandMark size={40} />
          <h1>dudu</h1>
        </header>

        <div className="login-alerts">
          {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
        </div>

        <Form className="login-form" onSubmit={async event => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError('');
          try { await login(password); navigate('/', { replace: true }); }
          catch (cause) { setError(cause instanceof ApiError && cause.status === 401 ? t('auth.invalid') : errorText(cause)); }
          finally { setPending(false); }
        }}>
          <TextField className="w-full" value={password} onChange={setPassword} isRequired type="password" autoComplete="current-password">
            <Label>{t('auth.password')}</Label>
            <Input autoFocus placeholder={t('auth.placeholderPassword')} />
          </TextField>
          <Button type="submit" variant="primary" className="w-full" isDisabled={pending}>{pending ? t('auth.verifying') : t('auth.enter')}</Button>
        </Form>

        <footer className="login-footer">
          <div className="login-lang" role="group" aria-label={t('nav.language')}>
            <Button size="sm" variant={locale === 'zh' ? 'secondary' : 'ghost'} className="min-w-0 rounded-full px-2.5" onPress={() => setLocale('zh')}>中</Button>
            <Button size="sm" variant={locale === 'en' ? 'secondary' : 'ghost'} className="min-w-0 rounded-full px-2.5" onPress={() => setLocale('en')}>EN</Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
