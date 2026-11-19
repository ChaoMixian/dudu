import type { BuiltinProvider, BuiltinProviderContext } from '../types';
import { stringSetting } from '../types';

interface Place { name: string; latitude: number; longitude: number; timezone?: string; country?: string; admin1?: string }
const placeCache = new Map<string, { at: number; place: Place }>();

const WEATHER_CODES: Record<number, string> = {
  0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
};

function weatherText(code: unknown): string {
  return typeof code === 'number' ? WEATHER_CODES[code] ?? `天气代码 ${code}` : '未知';
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function json(url: string, signal?: AbortSignal): Promise<any> {
  let lastError: unknown;
  const deadline = Date.now() + 15_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw signal.reason;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.min(6_000, remaining))]) });
      const text = await response.text();
      if (response.ok) {
        try { return JSON.parse(text); } catch { throw new Error('Open-Meteo returned invalid JSON'); }
      }
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await wait(300 * (attempt + 1)); continue; }
      const httpError = new Error(`Open-Meteo returned HTTP ${response.status}: ${text.slice(0, 300)}`) as Error & { httpStatus?: number };
      httpError.httpStatus = response.status;
      throw httpError;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error && typeof error === 'object' && 'httpStatus' in error) throw error;
      lastError = error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (attempt < 2) await wait(300 * (attempt + 1));
    }
  }
  throw new Error(`天气服务暂时不可用，请稍后重试${lastError instanceof Error ? `（${lastError.message.slice(0, 120)}）` : ''}`);
}

async function place(ctx: BuiltinProviderContext, signal?: AbortSignal): Promise<Place> {
  const city = stringSetting(ctx.settings, 'city', 'City');
  const cached = placeCache.get(city.toLowerCase());
  if (cached && Date.now() - cached.at < 6 * 60 * 60_000) return cached.place;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  const payload = await json(url.toString(), signal);
  const result = Array.isArray(payload.results) ? payload.results[0] : undefined;
  if (!result || typeof result.latitude !== 'number' || typeof result.longitude !== 'number') throw new Error(`City not found: ${city}`);
  const resolved: Place = {
    name: String(result.name ?? city),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: typeof result.timezone === 'string' ? result.timezone : undefined,
    country: typeof result.country === 'string' ? result.country : undefined,
    admin1: typeof result.admin1 === 'string' ? result.admin1 : undefined,
  };
  placeCache.set(city.toLowerCase(), { at: Date.now(), place: resolved });
  return resolved;
}

function locationOf(value: Place) {
  return { name: value.name, country: value.country ?? null, region: value.admin1 ?? null, latitude: value.latitude, longitude: value.longitude, timezone: value.timezone ?? null };
}

async function current(ctx: BuiltinProviderContext, signal?: AbortSignal) {
  const p = await place(ctx, signal);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(p.latitude));
  url.searchParams.set('longitude', String(p.longitude));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('timezone', 'auto');
  const payload = await json(url.toString(), signal);
  const c = payload.current ?? {};
  return {
    location: locationOf(p),
    current: {
      time: c.time, temperature: c.temperature_2m, apparentTemperature: c.apparent_temperature,
      humidity: c.relative_humidity_2m, precipitation: c.precipitation, windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m, isDay: c.is_day === 1, weatherCode: c.weather_code, condition: weatherText(c.weather_code),
    },
  };
}

async function forecast(ctx: BuiltinProviderContext, days: number, signal?: AbortSignal) {
  const p = await place(ctx, signal);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(p.latitude));
  url.searchParams.set('longitude', String(p.longitude));
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,wind_speed_10m_max');
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('timezone', 'auto');
  const payload = await json(url.toString(), signal);
  const d = payload.daily ?? {};
  const list = Array.isArray(d.time) ? d.time.map((date: string, index: number) => ({
    date,
    weatherCode: d.weather_code?.[index],
    condition: weatherText(d.weather_code?.[index]),
    temperatureMax: d.temperature_2m_max?.[index],
    temperatureMin: d.temperature_2m_min?.[index],
    precipitationProbability: d.precipitation_probability_max?.[index],
    precipitation: d.precipitation_sum?.[index],
    sunrise: d.sunrise?.[index],
    sunset: d.sunset?.[index],
    windSpeedMax: d.wind_speed_10m_max?.[index],
  })) : [];
  return { location: locationOf(p), days: list };
}

async function air(ctx: BuiltinProviderContext, signal?: AbortSignal) {
  const p = await place(ctx, signal);
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(p.latitude));
  url.searchParams.set('longitude', String(p.longitude));
  url.searchParams.set('current', 'pm2_5,pm10,us_aqi,european_aqi,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide');
  url.searchParams.set('timezone', 'auto');
  const payload = await json(url.toString(), signal);
  return { location: locationOf(p), current: payload.current ?? {} };
}

export const weatherProvider: BuiltinProvider = {
  id: 'weather',
  name: '天气',
  description: '查询天气、预报和空气质量。',
  descriptionEn: 'Current weather, forecast, and air quality.',
  category: 'utility',
  fields: [
    { key: 'city', label: '城市', labelEn: 'City', type: 'text', required: true, placeholder: '例如：杭州', help: '使用城市名查询；同名城市会取第一个匹配结果。', helpEn: 'Use a city name; if several places share it, the first match is used.' },
  ],
  tools: [
    {
      name: 'weather',
      description: 'Get current weather, a daily forecast, or air quality for the configured city. Use kind="current" for now, "forecast" for upcoming days, and "air" for PM2.5/AQI.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['current', 'forecast', 'air'], description: 'Which report to return' },
          days: { type: 'integer', minimum: 1, maximum: 16, description: 'Forecast days (forecast only)' },
        },
      },
    },
  ],
  normalize(settings) {
    return { settings: { city: stringSetting(settings, 'city', 'City') }, credentials: {} };
  },
  async test(ctx, options) {
    return current(ctx, options.signal);
  },
  async call(tool, args, ctx, options) {
    if (tool !== 'weather') throw new Error(`Unknown Weather tool: ${tool}`);
    const kind = typeof args.kind === 'string' ? args.kind : 'current';
    if (kind === 'current') return current(ctx, options.signal);
    if (kind === 'forecast') {
      const days = Number.isInteger(args.days) ? Math.max(1, Math.min(16, Number(args.days))) : 3;
      return forecast(ctx, days, options.signal);
    }
    if (kind === 'air') return air(ctx, options.signal);
    throw new Error(`Unknown weather kind: ${kind}`);
  },
};
