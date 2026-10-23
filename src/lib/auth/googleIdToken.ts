/* Verifies a Google Identity Services credential (ID token) against Google's JWKS (spec §4.3). */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleIdentity { sub: string; email: string; email_verified: boolean; given_name: string; family_name: string; picture: string | null }

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity | null> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience || !credential) return null;
  try {
    const { payload } = await jwtVerify(credential, JWKS, {
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      email_verified: payload.email_verified === true || payload.email_verified === 'true',
      given_name: typeof payload.given_name === 'string' ? payload.given_name : '',
      family_name: typeof payload.family_name === 'string' ? payload.family_name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  } catch {
    return null;
  }
}
