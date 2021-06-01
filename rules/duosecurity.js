function (user, context, callback) {
  const CLIENTS_WHICH_ALLOW_ENROLLMENT = [
    '7fMOgA3HQ8QxD6nJ9A2JDgfi6qpr33wW',    // login-dev1.corpdmz.mdc1.mozilla.com (rta-dev)
    'wuUwOl2c6yrrZdDzzt34YMyPM1mQqAQV',    // login.mozilla.com
  ];

  const EMAIL_WHITELIST = [
    'moc+servicenow@mozilla.com',      // MOC see: https://bugzilla.mozilla.org/show_bug.cgi?id=1423903
    'moc-sso-monitoring@mozilla.com',  // MOC see: https://bugzilla.mozilla.org/show_bug.cgi?id=1423903
  ];

  if (!user.email_verified) {
    console.log(`duosecurity: user primary email NOT verified, refusing login for ${user.email}`);
    return callback(null, user, global.postError('notingroup', context));
  }

  // fake 2FA for the MOC service accounts
  if (EMAIL_WHITELIST.includes(user.email)) {
    console.log(`duosecurity: whitelisted account ${user.email}, no 2FA check performed`);
    context.multifactor = true;
    return callback(null, user, context);
  }

  // only those people using LDAP are required to use 2FA
  if (context.connectionStrategy !== 'ad') {
    console.log(`duosecurity: 2FA not required for non-LDAP user: ${user.email}`);
    return callback(null, user, context);
  }

  context.multifactor = {
    host: configuration.duo_apihost_mozilla,
    provider: 'duo',
    username: user.email,

    // we currently let people store a cookie to cache their 2FA session for an unchangable 30 days
    // note that we could in the future set this to `true` to force a 2FA login every time or for
    // critical users
    ignoreCookie: false,
  }

  // login sites allow direct enrollment of Duo tokens
  if (CLIENTS_WHICH_ALLOW_ENROLLMENT.includes(context.clientID)) {
    console.log(`duosecurity: ${user.email} is in LDAP and requires 2FA check or enrollment`);

    context.multifactor = {
      ...context.multifactor,
      ikey: configuration.login_ikey_mozilla,
      skey: configuration.login_skey_mozilla,
    }
  } else {
    console.log(`duosecurity: ${user.email} is in LDAP and requires 2FA check`);

    context.multifactor = {
      ...context.multifactor,
      ikey: configuration.duo_ikey_mozilla,
      skey: configuration.duo_skey_mozilla,
    };
  }

  return callback(null, user, context);
}
