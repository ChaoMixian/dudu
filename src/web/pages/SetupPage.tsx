import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Label, ListBox, Select, Spinner, TextArea, TextField } from '@heroui/react';
import type { BotConfig, ProviderConfig } from '../../contracts';
import { completeSetup, discoverProviderModels, errorText, request, type DiscoveredModel } from '../lib/api';
import { randomBotColor } from '../lib/bot-theme';
import ProfileAvatarPicker from '../ui/ProfileAvatarPicker';
import { initialStyle, initialPreset } from '../lib/profile-avatar';
import { randomId } from '../lib/random';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { useLive } from '../state/LiveContext';
import { useThemeMode } from '../ui/theme';
import BrandMark from '../ui/BrandMark';
import BotAvatar from '../ui/BotAvatar';
import BotAvatarPicker from '../ui/BotAvatarPicker';
import Icon from '../ui/Icon';
import { buildProvider, providerDraft, mergeProvider, newModelDraft, PROVIDER_APIS, type ProviderDraft } from './provider-forms';
import SetupMeteors from './SetupMeteors';
import SetupWelcome from './SetupWelcome';

type Step = 'welcome' | 'bot' | 'profile' | 'password' | 'model' | 'done';
const STEP_NUMBER: Record<Exclude<Step, 'welcome'>, number> = { bot: 2, profile: 3, password: 4, model: 5, done: 6 };
const TOTAL_STEPS = 6;
const API_LABEL = {
  'openai-completions': 'providers.apiCompletions',
  'openai-responses': 'providers.apiResponses',
  'anthropic-messages': 'providers.apiAnthropic',
} as const;

export default function SetupPage() {
  const { token, adopt } = useAuth();
  const { state, refresh } = useLive();
  const { t, locale, setLocale } = useI18n();
  const { resolved, setMode } = useThemeMode();
  const [step, setStep] = useState<Step>('welcome');
  const [api, setApi] = useState<ProviderConfig['api']>('openai-completions');
  const [providerId] = useState(() => `setup-${randomId().slice(0, 8)}`);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [savedProvider, setSavedProvider] = useState<ProviderConfig | null>(null);
  const [createdBot, setCreatedBot] = useState<BotConfig | null>(null);
  const [botName, setBotName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [color, setColor] = useState(() => randomBotColor().id);
  const [profileName, setProfileName] = useState(state.profile?.name ?? '');
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(state.profile?.avatar);
  const [profileStyle, setProfileStyle] = useState(() => initialStyle(state.profile ?? {}));
  const [profilePreset, setProfilePreset] = useState(() => initialPreset(profileStyle, state.profile ?? {}));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [modelSkipped, setModelSkipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const hydrated = useRef(false);

  useEffect(() => { setMode('system'); }, [setMode]);

  useEffect(() => {
    const existing = state.providers[0];
    if (!existing || hydrated.current) return;
    hydrated.current = true;
    setSavedProvider(existing);
    setApi(existing.api);
    setBaseUrl(existing.baseUrl);
    setApiKey(existing.apiKey ?? '');
    setModelId(existing.models[0]?.id ?? '');
  }, [state.providers]);

  useEffect(() => {
    setModels([]);
    setDiscoveryError('');
    setDiscoveryDone(false);
    setDiscovering(false);
    if (step !== 'model') return;
    try { if (!['http:', 'https:'].includes(new URL(baseUrl.trim()).protocol)) return; } catch { return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDiscovering(true);
      try {
        const next = await discoverProviderModels(token, { api, baseUrl: baseUrl.trim(), apiKey }, controller.signal);
        if (!controller.signal.aborted) {
          setModels(next);
          setDiscoveryDone(true);
          setModelId(current => current || next[0]?.id || '');
        }
      } catch (cause) {
        if (!controller.signal.aborted) setDiscoveryError(errorText(cause));
      } finally {
        if (!controller.signal.aborted) setDiscovering(false);
      }
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [step, token, api, baseUrl, apiKey]);

  const go = (next: Step) => { setError(''); setStep(next); };

  const nextBot = () => {
    if (!botName.trim()) { setError(t('setup.botRequired')); return; }
    go('profile');
  };

  const saveProfile = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await request(token, '/profile', 'PUT', {
        name: profileName.trim(), avatar: profileAvatar, avatarStyle: profileStyle, avatarPreset: profilePreset,
      });
      await refresh();
      setStep('password');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  const savePassword = async () => {
    if (pending) return;
    const next = password.trim();
    if (next.length < 6) { setError(t('setup.passwordRequired')); return; }
    if (next !== confirmPassword.trim()) { setError(t('setup.passwordMismatch')); return; }
    setPending(true);
    setError('');
    try {
      const result = await request<{ token: string }>(token, '/setup/password', 'PUT', { password: next });
      adopt(result.token);
      setStep('model');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  const saveProvider = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const model = modelId.trim();
      if (!baseUrl.trim() || !model) throw new Error(t('setup.providerRequired'));
      const original = providerDraft(savedProvider ?? undefined);
      const modelDraft = original.models.find(item => item.id === model) ?? { ...newModelDraft(original.models.length), id: model, name: model };
      const draft: ProviderDraft = {
        id: savedProvider?.id ?? providerId,
        name: savedProvider?.name || t('setup.defaultProviderName'),
        api,
        baseUrl: baseUrl.trim(),
        apiKey,
        models: [...original.models.filter(item => item.id.trim() && item.id !== model), modelDraft],
      };
      const provider = buildProvider(draft, savedProvider ?? undefined, t);
      const providers = mergeProvider(state.providers, savedProvider ?? undefined, provider, t);
      await request(token, '/providers', 'PUT', { providers });
      await request(token, '/defaults', 'PUT', { provider: provider.id, model });
      await refresh();
      setSavedProvider(provider);
      setModelSkipped(false);
      setStep('done');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  const finish = async () => {
    if (pending) return;
    if (!createdBot && !botName.trim()) {
      setError(t('setup.botRequired'));
      return;
    }
    setPending(true);
    setError('');
    try {
      let bot = createdBot;
      if (!bot) {
        bot = await request<BotConfig>(token, '/bots', 'POST', {
          name: botName.trim(), description: description.trim(), avatar, color,
        });
        setCreatedBot(bot);
      }
      await completeSetup(token);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  if (step === 'welcome') return <SetupWelcome onDone={() => setStep('bot')} />;

  const title = step === 'bot' ? t('setup.botTitle')
    : step === 'profile' ? t('setup.profileTitle')
    : step === 'password' ? t('setup.passwordTitle')
    : step === 'model' ? t('setup.modelTitle')
    : t('setup.doneTitle');
  const lead = step === 'bot' ? t('setup.botLead')
    : step === 'profile' ? t('setup.profileLead')
    : step === 'password' ? t('setup.passwordLead')
    : step === 'model' ? t('setup.modelLead')
    : t(modelSkipped ? 'setup.doneWithoutModel' : 'setup.doneLead', { name: botName.trim() || 'Bot' });

  return (
    <div className="setup-page">
      <SetupMeteors />
      <div className="setup-shell">
        <header className="setup-top">
          <div className="setup-brand"><BrandMark size={30} /><span>dudu</span></div>
          <div className="setup-tools">
            <Button size="sm" variant="ghost" className="rounded-full" onPress={() => setLocale(locale === 'zh' ? 'en' : 'zh')} aria-label={t('nav.language')}>
              {locale === 'zh' ? 'EN' : '中'}
            </Button>
            <Button isIconOnly size="sm" variant="ghost" className="rounded-full" aria-label={t(resolved === 'dark' ? 'ui2.lightMode' : 'ui2.darkMode')} onPress={() => setMode(resolved === 'dark' ? 'light' : 'dark')}>
              <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={17} />
            </Button>
          </div>
        </header>

        <section className="setup-card" aria-label={t('setup.title')}>
          <header className="setup-head">
            <div>
              <h1>{title}</h1>
              <p>{lead}</p>
            </div>
            <span className="setup-count">{STEP_NUMBER[step]} / {TOTAL_STEPS}</span>
          </header>

          {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}

          {step === 'bot' && (
            <form className="setup-form" onSubmit={event => { event.preventDefault(); nextBot(); }}>
              <div className="setup-fields setup-fields-single">
                <TextField isDisabled={pending} value={botName} onChange={setBotName} isRequired>
                  <Label>{t('setup.botName')}</Label>
                  <Input placeholder={t('setup.botPlaceholder')} maxLength={80} />
                </TextField>
                <TextField isDisabled={pending} value={description} onChange={setDescription}>
                  <Label>{t('setup.botDescription')}</Label>
                  <TextArea rows={3} maxLength={4000} placeholder={t('createBot.descriptionPlaceholder')} />
                </TextField>
              </div>
              <BotAvatarPicker name={botName} avatar={avatar} color={color} disabled={pending} autoSelect onAvatar={setAvatar} onColor={setColor} />
              <div className="setup-actions setup-actions-end">
                <Button type="submit" variant="primary" className="rounded-full" isDisabled={pending || !botName.trim()}>
                  {t('setup.next')}<Icon name="chevron" size={16} />
                </Button>
              </div>
            </form>
          )}

          {step === 'profile' && (
            <form className="setup-form" onSubmit={event => { event.preventDefault(); void saveProfile(); }}>
              <TextField isDisabled={pending} value={profileName} onChange={setProfileName}>
                <Label>{t('setup.profileName')}</Label>
                <Input placeholder={t('setup.profilePlaceholder')} maxLength={80} />
              </TextField>
              <ProfileAvatarPicker name={profileName} avatar={profileAvatar} styleId={profileStyle} presetId={profilePreset} disabled={pending} autoSelect onAvatar={setProfileAvatar} onStyle={setProfileStyle} onPreset={setProfilePreset} />
              <div className="setup-actions">
                <Button type="button" variant="tertiary" className="setup-back rounded-full" isDisabled={pending} onPress={() => go('bot')}>{t('setup.back')}</Button>
                <Button type="submit" variant="primary" className="rounded-full" isDisabled={pending}>
                  {pending ? <Spinner size="sm" /> : null}{t('setup.next')}<Icon name="chevron" size={16} />
                </Button>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form className="setup-form" onSubmit={event => { event.preventDefault(); void savePassword(); }}>
              <div className="setup-fields">
                <TextField isDisabled={pending} value={password} onChange={setPassword} isRequired>
                  <Label>{t('setup.password')}</Label>
                  <Input type="password" autoComplete="new-password" placeholder={t('setup.passwordPlaceholder')} maxLength={128} />
                </TextField>
                <TextField isDisabled={pending} value={confirmPassword} onChange={setConfirmPassword} isRequired>
                  <Label>{t('setup.passwordConfirm')}</Label>
                  <Input type="password" autoComplete="new-password" placeholder={t('setup.passwordConfirmPlaceholder')} maxLength={128} />
                </TextField>
              </div>
              <div className="setup-actions">
                <Button type="button" variant="tertiary" className="setup-back rounded-full" isDisabled={pending} onPress={() => go('profile')}>{t('setup.back')}</Button>
                <Button type="submit" variant="primary" className="rounded-full" isDisabled={pending}>
                  {pending ? <Spinner size="sm" /> : null}{t('setup.next')}<Icon name="chevron" size={16} />
                </Button>
              </div>
            </form>
          )}

          {step === 'model' && (
            <form className="setup-form" onSubmit={event => { event.preventDefault(); void saveProvider(); }}>
              <div className="setup-fields">
                <Select selectedKey={api} onSelectionChange={key => { if (key !== null) setApi(key as ProviderConfig['api']); }} isDisabled={pending}>
                  <Label>{t('setup.providerApi')}</Label>
                  <Select.Trigger className="rounded-xl"><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox items={PROVIDER_APIS.map(value => ({ key: value, label: t(API_LABEL[value]) }))}>
                    {item => <ListBox.Item id={item.key} textValue={item.label}>{item.label}</ListBox.Item>}
                  </ListBox></Select.Popover>
                </Select>
                <TextField isDisabled={pending} value={baseUrl} onChange={setBaseUrl} isRequired>
                  <Label>{t('setup.baseUrl')}</Label>
                  <Input placeholder="https://api.example.com/v1" autoComplete="url" spellCheck={false} />
                </TextField>
                <TextField isDisabled={pending} value={apiKey} onChange={setApiKey}>
                  <Label>{t('setup.apiKey')}</Label>
                  <Input type="password" placeholder="sk-…" autoComplete="off" />
                </TextField>
                <TextField isDisabled={pending} value={modelId} onChange={setModelId} isRequired>
                  <Label>{t('setup.modelId')}</Label>
                  <Input placeholder={t('setup.modelPlaceholder')} autoComplete="off" spellCheck={false} />
                </TextField>
              </div>
              <div className="setup-model-discovery" aria-live="polite">
                {discovering && <p className="setup-hint">{t('setup.fetchingModels')}</p>}
                {discoveryError && <Alert status="warning"><Alert.Content><Alert.Description>{t('setup.discoveryFailed')} {discoveryError}</Alert.Description></Alert.Content></Alert>}
                {discoveryDone && !models.length && <p className="setup-hint">{t('setup.noModels')}</p>}
                {!!models.length && <Select selectedKey={models.some(model => model.id === modelId) ? modelId : null} isDisabled={pending} onSelectionChange={key => { if (key !== null) setModelId(String(key)); }}>
                  <Label>{t('setup.availableModels')}</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>{models.map(model => <ListBox.Item key={model.id} id={model.id} textValue={model.name}>{model.name}</ListBox.Item>)}</ListBox></Select.Popover>
                </Select>}
              </div>
              <div className="setup-actions setup-actions-model">
                <Button type="button" variant="tertiary" className="setup-back rounded-full" isDisabled={pending} onPress={() => go('password')}>{t('setup.back')}</Button>
                <div className="setup-actions-right">
                  <Button type="button" variant="ghost" className="rounded-full" isDisabled={pending} onPress={() => { setModelSkipped(true); go('done'); }}>{t('setup.skipModel')}</Button>
                  <Button type="submit" variant="primary" className="rounded-full" isDisabled={pending || !baseUrl.trim() || !modelId.trim()}>
                    {pending ? <Spinner size="sm" /> : null}{t('setup.next')}<Icon name="chevron" size={16} />
                  </Button>
                </div>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div className="setup-done">
              <BotAvatar name={botName || 'Bot'} avatar={avatar} color={color} size="lg" />
              <Button variant="primary" className="rounded-full" isDisabled={pending} onPress={() => void finish()}>
                {pending ? <Spinner size="sm" /> : null}{t('setup.enter', { name: botName.trim() || 'Bot' })}<Icon name="chevron" size={16} />
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
