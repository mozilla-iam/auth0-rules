function (user, context, callback) {
  const CLIENTS = {
    'wgh8S9GaE7sJ4i0QrAzeMxFXgWZYtB0l': 'sage-intacct',    // Sage Intacct
    'R4djNlyXSl3i8N2KXWkfylghDa9kFQ84': 'thinksmart',      // mozilla.tap.thinksmart.com
    'cEfnJekrSStxxxBascTjNEDAZVUPAIU2': 'stripe-subplat',  // Stripe - subplat
    'inoLoMyAEOzLX1cZOvubQpcW18pk4O1S': 'acoustic-stage',  // Acoustic stage
    'sBImsybtPPLyWlstD0SC35IwnAafE4nB': 'acoustic-prod',   // Acoustic prod
    'H5ddlJSCfGP8ab65EnWaB2sd541CJAlM': 'planful',   // Planful prod
    'pUmRmcBrAJEdsgRTVXIW84jZoc3wtuYO': 'planful-dev',   // Planful dev
  };
  const client = CLIENTS[context.clientID];

  // many SAML implementations require your id (email address) twice, but SAML configurations
  // inside auth0 can only map from an attribute once
  user._email = user.email;

  // if it's not a client that uses SAML, exit immediately
  if (!client) {
    return callback(null, user, context);
  }

  // `context.samlConfiguration` should always be set
  // but this is a protective measure just in case
  context.samlConfiguration = context.samlConfiguration || {};

  switch(client) {
    case 'sage-intacct':
      user.company_name = 'MOZ Corp';

      context.samlConfiguration.mappings = {
        'Company Name': 'company_name',
        'emailAddress': 'email',
        'name': 'name',
      };

      break;

    case 'planful-dev':
      user["IdP Entity ID"] = "urn:auth-dev.mozilla.auth0.com";
      break;

    case 'planful':
      user["IdP Entity ID"] = "urn:auth.mozilla.auth0.com";
      break;

    case 'thinksmart':
      context.samlConfiguration.mappings = {
        'Email': 'email',
        'firstName': 'given_name',
        'lastName': 'family_name',
      };

      break;
    case 'stripe-subplat':
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1637117
      const groupToStripeRoleMap = {
        //  LDAP group name          stripe_role_name           stripe_account_id
        'stripe_subplat_admin': [{'role': 'admin', 'account': 'acct_1EJOaaJNcmPzuWtR'}],
        'stripe_subplat_developer': [{'role': 'developer', 'account': 'acct_1EJOaaJNcmPzuWtR'}],
        'stripe_subplat_supportsp': [{'role': 'support_specialist', 'account': 'acct_1EJOaaJNcmPzuWtR'}],
        'stripe_subplat_analyst': [{'role': 'analyst', 'account': 'acct_1EJOaaJNcmPzuWtR'}],
        'stripe_subplat_viewonly': [{'role': 'view_only', 'account': 'acct_1EJOaaJNcmPzuWtR'}]
      };
      context.samlConfiguration.mappings = context.samlConfiguration.mappings || {};
      Object.keys(groupToStripeRoleMap).forEach((groupName) => {
        if (user.hasOwnProperty('groups') && user.groups.includes(groupName)) {
          groupToStripeRoleMap[groupName].forEach((roleInfo) => {
            user.app_metadata[roleInfo.account] = roleInfo.role;
            context.samlConfiguration.mappings[`Stripe-Role-${roleInfo.account}`] = `app_metadata.${roleInfo.account}`;
          });
        }
      });
      break;
    case 'acoustic-stage':
      context.samlConfiguration.mappings = {
        'Nameid': 'email',
        'email': 'email',
        'firstName': 'given_name',
        'lastName': 'family_name'
      };

      break;
    case 'acoustic-prod':
      context.samlConfiguration.mappings = {
        'Nameid': 'email',
        'email': 'email',
        'firstName': 'given_name',
        'lastName': 'family_name'
      };

      break;
  }

  return callback(null, user, context);
}
