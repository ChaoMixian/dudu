import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Label, TextField } from '@heroui/react';
import { errorText } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import BrandMark from '../ui/BrandMark';

export default function LoginPage() {
  const { login, authRequired } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <div className="login-page">
      <div className="login-glow" aria-hidden="true" />
      <section className="login-panel" aria-label={t('app.name')}>
        <header className="login-brand">
          <BrandMark size={40} />
          <h1>dudu</h1>
        </header>

        <div className="login-alerts">
          {authRequired === null && <Alert status="warning"><Alert.Content><Alert.Description>{t('auth.unreachable')}</Alert.Description></Alert.Content></Alert>}
          {authRequired === false && (
            <Alert status="warning">
              <Alert.Content>
                <Alert.Title>{t('auth.noAuthTitle')}</Alert.Title>
                <Alert.Description>{t('auth.noAuthBody')}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
        </div>

        <Form className="login-form" onSubmit={async event => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError('');
          try { await login(token); navigate('/', { replace: true }); }
          catch (cause) { setError(errorText(cause)); }
          finally { setPending(false); }
        }}>
          <TextField className="w-full" value={token} onChange={setToken} isRequired={authRequired === true} type="password" autoComplete="off">
            <Label>{t('auth.token')}</Label>
            <Input autoFocus placeholder={authRequired ? t('auth.placeholderToken') : t('auth.tokenOptional')} />
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
