// Transactional email templates for invites + password resets. These
// go through notifications.sendRaw() rather than sendEmail() because
// sendEmail targets the global notify_email_to (alert recipient), and
// transactional mail needs per-message addressing.

const COLOR_PRIMARY = '#0f766e'; // emerald-700 — matches the alert info color
const COLOR_MUTED = '#64748b';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function baseHtml({ heading, lead, ctaLabel, ctaUrl, footer }) {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b0f14">
    <div style="border-left:3px solid ${COLOR_PRIMARY};padding:16px 20px;background:#f8fafc;border-radius:4px">
      <h2 style="margin:0 0 12px;color:${COLOR_PRIMARY};font-size:17px">${esc(heading)}</h2>
      <div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(lead)}</div>
      <p style="margin:20px 0 8px">
        <a href="${esc(ctaUrl)}" style="display:inline-block;background:${COLOR_PRIMARY};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${esc(ctaLabel)}</a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:${COLOR_MUTED};word-break:break-all">
        Or paste this link into your browser: <br/>
        <span style="font-family:ui-monospace,monospace">${esc(ctaUrl)}</span>
      </p>
    </div>
    <p style="color:${COLOR_MUTED};font-size:11px;margin-top:16px">${esc(footer)}</p>
  </body></html>`;
}

function formatExpiry(expires_at) {
  try {
    const d = new Date(expires_at);
    const hrs = Math.max(1, Math.round((d.getTime() - Date.now()) / 3600000));
    return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  } catch {
    return '72 hours';
  }
}

function inviteEmail({ inviter_name, inviter_email, role, link, expires_at }) {
  const inviter = inviter_name || inviter_email || 'A frutero owner';
  const heading = `You're invited to frutero`;
  const lead = `${inviter} invited you to join their grow-chamber control panel as a ${role}.\n\nClick below to set up your account. This invitation expires in ${formatExpiry(expires_at)}.`;
  return {
    subject: `frutero · ${inviter} invited you (${role})`,
    text: `${heading}\n\n${lead}\n\n${link}\n\nIf you weren't expecting this, you can ignore this email.`,
    html: baseHtml({
      heading,
      lead,
      ctaLabel: 'Accept invite',
      ctaUrl: link,
      footer: `Sent by your frutero grow chamber. If you weren't expecting this invite, you can ignore this email.`,
    }),
  };
}

function passwordResetEmail({ target_name, issuer_name, link, expires_at }) {
  const who = target_name ? `Hi ${target_name},` : 'Hello,';
  const by = issuer_name ? ` by ${issuer_name}` : '';
  const heading = 'Reset your frutero password';
  const lead = `${who}\n\nA password reset was issued for your frutero account${by}. Click below to choose a new password. This link expires in ${formatExpiry(expires_at)}.`;
  return {
    subject: `frutero · password reset`,
    text: `${heading}\n\n${lead}\n\n${link}\n\nIf you didn't expect this, you can ignore the email — the old password still works.`,
    html: baseHtml({
      heading,
      lead,
      ctaLabel: 'Set new password',
      ctaUrl: link,
      footer: `Sent by your frutero grow chamber. If you didn't request this reset, ignore the email — your current password still works.`,
    }),
  };
}

module.exports = { inviteEmail, passwordResetEmail };
