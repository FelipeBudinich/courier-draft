import fs from 'node:fs';
import path from 'node:path';

import { env, supportedLocales } from './env.js';

const localesDirectory = path.resolve(process.cwd(), 'locales');

const catalogs = new Map(
  supportedLocales.map((locale) => [
    locale,
    JSON.parse(
      fs.readFileSync(path.join(localesDirectory, locale, 'common.json'), 'utf8')
    )
  ])
);

const getNestedValue = (object, key) =>
  key.split('.').reduce((value, segment) => value?.[segment], object);

const interpolate = (template, params = {}) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));

export const isSupportedLocale = (locale) => supportedLocales.includes(locale);

export const resolveLocale = (value) =>
  isSupportedLocale(value) ? value : env.defaultLocale;

export const detectLocale = ({ currentUser, cookies = {}, acceptLanguage = '' }) => {
  const candidates = [
    currentUser?.preferences?.locale,
    currentUser?.locale,
    cookies[env.localeCookieName],
    ...acceptLanguage
      .split(',')
      .map((item) => item.trim().split(';')[0]?.slice(0, 2))
  ].filter(Boolean);

  const matched = candidates.find((candidate) => isSupportedLocale(candidate));
  return matched ?? env.defaultLocale;
};

export const getAvailableLocales = () => [...supportedLocales];

export const translate = (locale, key, params = {}) => {
  const safeLocale = resolveLocale(locale);
  const value = getNestedValue(catalogs.get(safeLocale), key);

  if (typeof value === 'string') {
    return interpolate(value, params);
  }

  const fallbackValue = getNestedValue(catalogs.get('en'), key);
  if (typeof fallbackValue === 'string' && env.isProduction) {
    return interpolate(fallbackValue, params);
  }

  return `[missing:${safeLocale}:${key}]`;
};

