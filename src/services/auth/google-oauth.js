import crypto from 'node:crypto';

import { badRequest, unauthorized } from '../../config/errors.js';
import { env } from '../../config/env.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_SCOPE = 'openid email profile';

export const buildGoogleAuthRequest = ({ returnTo }) => {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCallbackUrl) {
    throw badRequest('Google OAuth is not configured for this environment.');
  }

  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleCallbackUrl,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state
  });

  return {
    state,
    url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    returnTo
  };
};

export const exchangeGoogleCodeForProfile = async ({ code }) => {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleCallbackUrl,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenResponse.ok) {
    throw unauthorized('Google sign-in could not be completed.');
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    throw unauthorized('Google sign-in could not be completed.');
  }

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!profileResponse.ok) {
    throw unauthorized('Google sign-in could not be completed.');
  }

  const profile = await profileResponse.json();

  if (!profile.email_verified) {
    throw unauthorized('Only verified Google email addresses can sign in.');
  }

  return {
    googleSub: String(profile.sub),
    email: String(profile.email).toLowerCase(),
    emailVerified: Boolean(profile.email_verified),
    displayName: profile.name?.trim() || profile.email,
    avatarUrl: profile.picture ?? '',
    locale: profile.locale?.slice(0, 2) ?? null
  };
};
