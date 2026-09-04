import {
  acceptInvite,
  confirmEmail,
  getUser,
  login,
  logout,
  recoverPassword,
  refreshSession,
  requestPasswordRecovery,
  signup,
  verifyRequestOrigin,
} from '@netlify/identity';

function json(data, status = 200) {
  return Response.json(data, { status });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.userMetadata?.full_name || user.user_metadata?.full_name || user.email || 'Player',
  };
}

function errorStatus(error) {
  const candidate = Number(error?.status || error?.statusCode || error?.code);
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 400;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function refreshIfPossible() {
  try {
    await refreshSession();
  } catch (error) {
    // A missing/expired session is a normal unauthenticated state. getUser() below
    // is the authority for whether this request is actually signed in.
    if (Number(error?.status || error?.statusCode) >= 500) throw error;
  }
}

export default async function hobunjiAuth(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    // Every auth request mutates or refreshes cookie-backed session state, so keep
    // the same-origin CSRF guard even for the status probe.
    verifyRequestOrigin(req);
    const body = await readBody(req);
    const action = String(body.action || 'status');

    if (action === 'status') {
      await refreshIfPossible();
      return json({ ok: true, user: publicUser(await getUser()) });
    }

    if (action === 'login') {
      if (!body.email || !body.password) return json({ ok: false, error: 'Email and password are required.' }, 400);
      const user = await login(String(body.email).trim(), String(body.password));
      return json({ ok: true, user: publicUser(user) });
    }

    if (action === 'signup') {
      if (!body.email || !body.password) return json({ ok: false, error: 'Email and password are required.' }, 400);
      const metadata = body.name ? { full_name: String(body.name).trim().slice(0, 120) } : undefined;
      const createdUser = await signup(String(body.email).trim(), String(body.password), metadata);
      // signup() can return the newly-created user before email confirmation has
      // established a session. Only report `user` when Identity says this request
      // is actually authenticated, otherwise the browser would try cloud APIs too early.
      const activeUser = await getUser();
      return json({
        ok: true,
        user: publicUser(activeUser),
        createdUser: publicUser(createdUser),
        message: activeUser
          ? 'Account created and signed in.'
          : 'Account created. Check your inbox for the Netlify Identity confirmation email, then return here.',
      });
    }

    if (action === 'logout') {
      await logout();
      return json({ ok: true, user: null });
    }

    if (action === 'confirm') {
      if (!body.token) return json({ ok: false, error: 'Confirmation token is required.' }, 400);
      const user = await confirmEmail(String(body.token));
      return json({ ok: true, user: publicUser(user), message: 'Email confirmed.' });
    }

    if (action === 'request-recovery') {
      if (!body.email) return json({ ok: false, error: 'Email is required.' }, 400);
      await requestPasswordRecovery(String(body.email).trim());
      return json({ ok: true, message: 'Password recovery email sent.' });
    }

    if (action === 'recover') {
      if (!body.token || !body.password) return json({ ok: false, error: 'Recovery token and new password are required.' }, 400);
      const user = await recoverPassword(String(body.token), String(body.password));
      return json({ ok: true, user: publicUser(user), message: 'Password updated.' });
    }

    if (action === 'accept-invite') {
      if (!body.token || !body.password) return json({ ok: false, error: 'Invite token and password are required.' }, 400);
      const user = await acceptInvite(String(body.token), String(body.password));
      return json({ ok: true, user: publicUser(user), message: 'Invitation accepted.' });
    }

    return json({ ok: false, error: `Unknown auth action: ${action}` }, 400);
  } catch (error) {
    console.error('[HobunjiCloudAuth]', error);
    return json({ ok: false, error: String(error?.message || error) }, errorStatus(error));
  }
}
