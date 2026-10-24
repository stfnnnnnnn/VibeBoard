/* Transactional email bodies (spec §3.4). Pure: string in, string out. Every interpolated user value is
   HTML-escaped; URLs are built server-side from AUTH_URL plus a random token. */
export interface MailContent { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function absoluteUrl(path: string): string {
  const base = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}

function layout(heading: string, bodyHtml: string, cta: { label: string; url: string }, footnote: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fbf8fb;font-family:'DM Sans',Arial,sans-serif;color:#1f1b2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;border:1px solid #ece8f0">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:800"><span style="color:#d9628c">Vibe</span><span style="color:#3d8fbf">Board</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;font-weight:700;letter-spacing:-0.02em">${esc(heading)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.55;color:#4a4458">${bodyHtml}</td></tr>
<tr><td style="padding:22px 28px 6px"><a href="${esc(cta.url)}" style="display:inline-block;background:#1f1b2b;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding:14px 28px 28px;font-size:12.5px;line-height:1.5;color:#6b6478">${footnote}<br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#3d8fbf">${esc(cta.url)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function resetMail(p: { firstName: string; url: string; minutes: number }): MailContent {
  const subject = 'Reset your VibeBoard password';
  const text = `Hi ${p.firstName},\n\nSomeone (hopefully you) asked to reset your VibeBoard password.\n\nSet a new one here: ${p.url}\n\nThis link works once and expires in ${p.minutes} minutes. If you didn't ask for this, you can ignore this email. Your password won't change.\n\nVibeBoard`;
  const html = layout(
    'Reset your password',
    `Hi ${esc(p.firstName)}, someone (hopefully you) asked to reset your VibeBoard password.`,
    { label: 'Set a new password', url: p.url },
    `This link works once and expires in ${p.minutes} minutes. If you didn't ask for this, ignore this email. Your password won't change.`,
  );
  return { subject, html, text };
}

export function googleAccountMail(p: { firstName: string; url: string; minutes: number }): MailContent {
  const subject = 'How to sign in to VibeBoard';
  const text = `Hi ${p.firstName},\n\nYour VibeBoard account signs in with Google. On the login page, choose "Continue with Google".\n\nWant to be able to log in with a password too? Set one here: ${p.url}\n\nThis link works once and expires in ${p.minutes} minutes.\n\nVibeBoard`;
  const html = layout(
    'You sign in with Google',
    `Hi ${esc(p.firstName)}, your VibeBoard account signs in with Google. On the login page, choose <b>Continue with Google</b>.<br><br>Want a password too? You can set one below.`,
    { label: 'Set a password', url: p.url },
    `This link works once and expires in ${p.minutes} minutes.`,
  );
  return { subject, html, text };
}

export function verifyMail(p: { firstName: string; url: string }): MailContent {
  const subject = 'Confirm your email for VibeBoard';
  const text = `Hi ${p.firstName},\n\nConfirm your email so you can always reset your password: ${p.url}\n\nThis link expires in 24 hours. Didn't create a VibeBoard account? Ignore this email.\n\nVibeBoard`;
  const html = layout(
    'Confirm your email',
    `Hi ${esc(p.firstName)}, welcome to VibeBoard! Confirm your email so you can always reset your password.`,
    { label: 'Confirm my email', url: p.url },
    "This link expires in 24 hours. Didn't create a VibeBoard account? Ignore this email.",
  );
  return { subject, html, text };
}
