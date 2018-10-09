function (user, context, callback) {
  // Imports
  const request = require('request');
  const YAML = require('js-yaml');
  const jose = require('node-jose');

  // Retrieve the access file information/configuration from well-known
  // See also https://github.com/mozilla-iam/cis/blob/profilev2/docs/.well-known/mozilla-iam.json
  function get_access_file_configuration(cb) {
    var access_file_conf = {};
    var options = { method: 'GET', url: configuration.iam_well_known };
    request(options, function (error, response, body) {
      if (error) throw new Error(error);
      if (response.statusCode !== 200) {
        console.log('Could not fetch access file URL: '+response.statusCode);
      } else {
        access_file_conf = JSON.parse(body).access_file;
        // contains mainly:
        // access_file_conf.endpoint  (URL)
        // access_file_conf.jwks.keys[]{} (pub keys)
        // access_file_conf.aai_mappings
      }
      return cb(access_file_conf);
    });
  }

  // Retrieve and verify access rule file itself
  function get_verified_access_rules(cb, access_file_conf) {
    // Bypass if we have a cached version present already
    // Cache is very short lived in webtask, it just means we hit a "hot" task which nodejs process hasn't yet been
    // terminated. Generally this means we hit the same task within 60s.
    if (global.access_rules) {
      return cb(global.access_rules, access_file_conf);
    }

    var options = { method: 'GET', url: access_file_conf.endpoint };
    var decoded;
    request(options, function (error, response, body) {
      if (error) throw new Error(error);
      // Convert key into jose-formatted-key
      // XXX remove this part of the code when well-known and signature exists
      if (access_file_conf.jwks === null) {
        console.log('WARNING: Bypassing access file signature verification');
        decoded = body;
      } else {
        // XXX verify key format when the well-known endpoint exists
        var pubkey = jose.JWK.asKey(access_file_conf.jwks.keys.x5c[0], 'pem').then((jwk) => jwk);
        var verifier = jose.JWS.createVerify(pubkey);
        var ret = verifier.verify(body).then((response) => response.payload).catch((err) => err);
        decoded = ret.then((data) => data).catch((err) => {
          throw new Error('Signature verification of access file failed (fatal): '+err);
        });
      }

      global.access_rules = YAML.load(decoded).apps;
      return cb(global.access_rules, access_file_conf);
    });
  }

  // Check if array A has any occurrence from array B
  function array_in_array(A, B) {
    var found = A.some(
      function(item) {
        if (!B)
          return false;
        return B.indexOf(item) >= 0;
    });
    return found;
  }

  // Update expiration and grant access
  function access_granted(a, b, c) {
    updateAccessExpiration();
    return callback(a, b, c);
  }

  // Deny access
  function access_denied(a, b, c) {
    return callback(a, b, c);
  }

  // updateAccessExpiration()
  // Always returns - will attempt to update user.app_metadata.authoritativeGroups[].lastUsed timestamp
  // for the RP/client_id we're currently trying to login to
  // XXX Use Profilev2 when available
  function updateAccessExpiration() {
      user.app_metadata = user.app_metadata || {};
      if (user.app_metadata.authoritativeGroups === undefined) {
          console.log('ExpirationOfAccess: not enabled for this user');
          return;
      }

      var updated = false;
      for (var index = 0;index < user.app_metadata.authoritativeGroups.length;++index) {
        if (user.app_metadata.authoritativeGroups[index].uuid === context.clientID) {
          user.app_metadata.authoritativeGroups[index].lastUsed = new Date();
          updated = true;
          break; // we're done
        }
      }
      if (updated === true) {
        auth0.users.updateAppMetadata(user.user_id, user.app_metadata)
          .catch(function(err) {
          console.log('ExpirationOfAccess: Error updating app_metadata (AuthoritativeGroups) for user '+user.user_id+': '+err);
        });
      }
      console.log('ExpirationOfAccess: Updated lastUsed for '+user.user_id);
      return;
  }

  // Process the access cache decision
  function access_decision(access_rules, access_file_conf) {
    // Use whatever is available from the group struct. Sometimes there's a race condition where user.app_metadata.*
    // isnt reintegrated to user.* for example
    var groups = user.app_metadata.groups || user.groups || [];
    // Defaut app requested aai level to MEDIUM for all apps which do not have this set in access file
    var required_aai_level = "MEDIUM";

    for (var i=0; i<access_rules.length; i++) {
      var app = access_rules[i].application;

      //Handy for quick testing in dev (overrides access rules)
      //var app = {'client_id': 'pCGEHXW0VQNrQKURDcGi0tghh7NwWGhW', // This is testrp social-ldap-pwless
      //           'authorized_users': ['gdestuynder@mozilla.com'],
      //           'authorized_groups': ['okta_mfa'],
      //           'expire_access_when_unused_after': 86400,
      //           'aai': 'LOW'
      //          };

      if (app.client_id && (app.client_id.indexOf(context.clientID) >= 0)) {
        // Set app AAI level if present
        required_aai_level = app.aai || required_aai_level;

        // EXPIRATION OF ACCESS
        // Note that the expiration check MUST always run first
        // Check if the user access to the RP has expired due to ExpirationOfAccess
        if ((app.expire_access_when_unused_after !== undefined) && (app.expire_access_when_unused_after > 0)) {
          user.app_metadata = user.app_metadata || {};
          // If the user has no authoritativeGroups for this clientID, let the user in
          if (user.app_metadata.authoritativeGroups !== undefined) {
            for (var index=0;index < user.app_metadata.authoritativeGroups.length; ++index) {
              if (user.app_metadata.authoritativeGroups[index].uuid === context.clientID) {
                // Find the delta for this user and see if access should have expired
                var lastUsed_ts = new Date(user.app_metadata.authoritativeGroups[index].lastUsed).getTime();
                var delta = new Date().getTime() - lastUsed_ts;
                // Access expired?
                if (delta > app.expire_access_when_unused_after) {
                    // Do not allow the user in, no matter what other access has been set
                    console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - access has expired");
                    return access_denied(null, user, global.postError('accesshasexpired', context));
                }
                break;
              }
            }
          }
        }

        // AUTHORIZED_{GROUPS,USERS}
        // XXX this authorized_users SHOULD BE REMOVED as it's unsafe (too easy to make mistakes). USE GROUPS.
        // XXX This needs to be fixed in the dashboard first
        // Empty users or groups (length == 0) means no access in the dashboard apps.yml world
        if (app.authorized_users.length === app.authorized_groups.length === 0) {
          console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - this app denies ALL users and ALL groups");
          return access_denied(null, user, global.postError('notingroup', context));
        }

        // Check if the user is authorized to access
        if ((app.authorized_users.length > 0 ) && (app.authorized_users.indexOf(user.email) >= 0)) {
          return access_granted(null, user, context);
        // Same dance as above, but for groups
        } else if ((app.authorized_groups.length > 0) && array_in_array(app.authorized_groups, groups)) {
          return access_granted(null, user, context);
        }

        console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - not in authorized group or not an authorized user");
        return access_denied(null, user, global.postError('notingroup', context));
      } // correct client id / we matched the current RP
    } // for loop / next rule in apps.yml

    // AAI (AUTHENTICATOR ASSURANCE INDICATOR) REQUIREMENTS
    //
    // Note that user.aai is set in another rule (rules/aai.js)
    //
    // Mapping logic and verification
    // Ex: our mapping says 2FA for MEDIUM AAI and app AAI is MEDIUM as well, and the user has 2FA AAI, looks like:
    // access_file_conf.aai_mapping['MEDIUM'] = ['2FA'];
    // app.aai = 'MEDIUM;
    // user.aai = ['2FA'];
    // Thus user should be allowed for this app (it requires MEDIUM, and MEDIUM requires 2FA, and user has 2FA
    // indeed)

    var aai_pass = false;
    if ((access_file_conf.aai_mapping !== undefined) && (access_file_conf.aai_mapping[required_aai_level].length === 0)) {
      // No required indicator in aai_mapping for this app's requested AAI
      aai_pass = true;
    } else {
      for (var y=0; y<user.aai.length; y++) {
        var this_aai = user.aai[y];
        if (access_file_conf.aai_mapping[required_aai_level].indexOf(this_aai) >= 0) {
          aai_pass = true;
          break;
        }
      }
    }

    if (!aai_pass) {
      console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - due to " +
        "Identity Assurance Verification being too low for this RP: Required AAI: "+required_aai_level+
        "("+aai_pass+")"); return access_denied(null, user, global.postError('aai_failed', context));
    } else {
      // Inform RPs of which AAI level let the user in
      var namespace = 'https://sso.mozilla.com/claim/';
      context.idToken[namespace+"AAI_LEVEL"] = required_aai_level;
    }

    // We matched no rule, access is granted
    return access_granted(null, user, context);
  }


  // "Main" starts here
  // This is a fake access file conf similar to the well-known endpoint,
  // until the well-known endpoint is actually available - it is also not signed and disables signing verification
  const fake_access_file_conf = { endpoint: 'https://cdn.sso.mozilla.com/apps.yml', jwks: null,
    aai_mapping: {
      "LOW": [],
      "MEDIUM": ["2FA", "HIGH_ASSURANCE_IDP"],
      "HIGH": [],
      "MAXIMUM": []
    }
  };
  // Get access file configuration, then get the access rules (apps.yml), then give all this to the access_decision()
  // function to decide if the user should be allowed or not. Any failure along the way will forbid the user to get in.
  return get_access_file_configuration(function(access_file_conf) {
    return get_verified_access_rules(access_decision, fake_access_file_conf);
  });
}
