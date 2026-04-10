const DEFAULT_RETURN_TO = '/app';

export const sanitizeReturnTo = (value, fallback = DEFAULT_RETURN_TO) => {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return fallback;
  }

  if (value.startsWith('//') || value.startsWith('/auth/google')) {
    return fallback;
  }

  return value;
};

export const buildOnboardingRedirect = () => '/settings/profile?onboarding=1';
