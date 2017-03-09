function (user, context, callback) {
  // /!\ DO NOT EDIT THIS FILE /!\
  // Please use http://github.com/mozilla-iam/auth0-rules instead

  // LDAP group okta_mfa requires MFA authentication everywhere.
  if (user.groups && user.groups.indexOf("okta_mfa") >= 0) {
    context.multifactor = {
      provider: 'duo',
      ikey: configuration.duo_ikey_mozilla,
      skey: configuration.duo_skey_mozilla,
      host: configuration.duo_apihost_mozilla,

      // optional:
      // Force DuoSecurity everytime this rule runs. Defaults to false.
      // If accepted by users the cookie lasts for 30 days - i.e. 30 days MFA session (this cannot be changed)
      ignoreCookie: false,
      username: user.email,
    };
  } else {
    // If user does not have Duo, clear context.multifactor as a work-around for the situation where Auth0
    // somehow loads a user session with attributes set that do not belong to the same user_uid and connection
    // See also https://github.com/mozilla-iam/auth0-deploy/issues/82
    context.multifactor = {
      provider: ''
    };
  }
  callback(null, user, context);
}
